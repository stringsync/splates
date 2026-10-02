import "../../../setup";
import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
// `screen` is deliberately unused: it binds to `document.body` when this module
// is imported, which happens before `./dom` registers one. The queries that
// `render` hands back bind on call instead.
import { Markdown } from "./markdown";

describe("Markdown", () => {
	it("renders a heading at its own level", () => {
		const page = render(<Markdown text={"# alpha\n\n## Goal\nland it\n"} />);

		expect(page.getByRole("heading", { level: 1 }).textContent).toBe("alpha");
		expect(page.getByRole("heading", { level: 2 }).textContent).toBe("Goal");
	});

	it("keeps lines that wrap in one paragraph", () => {
		const { container } = render(
			<Markdown text={"one or two lines:\nwhat done means.\n"} />,
		);

		expect(container.querySelectorAll("p")).toHaveLength(1);
	});

	it("gives a checklist item a disabled checkbox, ticked when the box was", () => {
		const { container } = render(
			<Markdown text={"- [ ] the rest\n- [x] landed\n"} />,
		);

		const boxes = [...container.querySelectorAll("input")];

		expect(boxes.map((box) => box.checked)).toEqual([false, true]);
		expect(boxes.every((box) => box.disabled)).toBe(true);
		expect(container.textContent).toContain("the rest");
	});

	it("renders a plain bullet without a checkbox", () => {
		const { container } = render(<Markdown text={"- a bullet\n"} />);

		expect(container.querySelector("li")?.textContent).toBe("a bullet");
		expect(container.querySelector("input")).toBeNull();
	});

	it("nests lists", () => {
		const { container } = render(
			<Markdown text={"- outer\n  - inner\n- next\n"} />,
		);

		expect(container.querySelectorAll("ul ul li")).toHaveLength(1);
		expect(container.querySelectorAll("ul > li")).toHaveLength(3);
	});

	it("renders a table", () => {
		const { container } = render(
			<Markdown text={"| a | b |\n| - | - |\n| 1 | 2 |\n"} />,
		);

		expect(
			[...container.querySelectorAll("td")].map((cell) => cell.textContent),
		).toEqual(["1", "2"]);
	});

	it("renders a fenced block as code, verbatim", () => {
		const { container } = render(
			<Markdown text={"```ts\nconst x = 1;\n```\n"} />,
		);

		expect(container.querySelector("pre code")?.textContent).toBe(
			"const x = 1;",
		);
	});

	it("renders inline code, bold and italics inside a line", () => {
		const { container } = render(
			<Markdown text={"run `arbor list` for **every** *task*\n"} />,
		);

		expect(container.querySelector("code")?.textContent).toBe("arbor list");
		expect(container.querySelector("strong")?.textContent).toBe("every");
		expect(container.querySelector("em")?.textContent).toBe("task");
	});

	it("links http destinations in a new tab, so the page keeps its place", () => {
		const { container } = render(
			<Markdown text={"open [the page](http://localhost:4269)"} />,
		);

		const link = container.querySelector("a");

		expect(link?.textContent).toBe("the page");
		expect(link?.getAttribute("href")).toBe("http://localhost:4269");
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("rel")).toContain("noopener");
	});

	it("links a bare URL", () => {
		const { container } = render(
			<Markdown text={"see https://example.com/a?b=1 for more"} />,
		);

		expect(container.querySelector("a")?.getAttribute("href")).toBe(
			"https://example.com/a?b=1",
		);
	});

	it("never makes a javascript: link clickable", () => {
		const { container } = render(
			<Markdown text={"[click](javascript:alert(1))"} />,
		);

		expect(container.querySelector("a[href]")).toBeNull();
	});

	it("renders markup in the source as text instead of elements", () => {
		const { container } = render(
			<Markdown text={"- [ ] drop <script>alert(1)</script>\n"} />,
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("li")?.textContent?.trim()).toBe(
			"drop <script>alert(1)</script>",
		);
	});

	it("shows an image as its alt text, since the page cannot load a local path", () => {
		const { container } = render(
			<Markdown text={"![the header](/abs/a.png)"} />,
		);

		expect(container.querySelector("img")).toBeNull();
		expect(container.textContent).toBe("[the header]");
	});
});

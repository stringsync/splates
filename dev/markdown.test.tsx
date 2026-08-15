import "../../../test-setup";
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

	it("renders prose as a paragraph, joining the lines it wrapped over", () => {
		const { container } = render(
			<Markdown text={"one or two lines:\nwhat done means.\n"} />,
		);

		expect(container.querySelector("p")?.textContent).toBe(
			"one or two lines: what done means.",
		);
	});

	it("gives a checklist item a real checkbox, ticked when the box was", () => {
		const { container } = render(
			<Markdown text={"- [ ] the rest\n- [x] landed\n"} />,
		);

		const boxes = [...container.querySelectorAll("input")];

		expect(boxes.map((box) => box.checked)).toEqual([false, true]);
		expect(container.textContent).toContain("the rest");
	});

	it("disables every checkbox, since the page only reports", () => {
		const { container } = render(<Markdown text={"- [ ] the rest\n"} />);

		expect(container.querySelector("input")?.disabled).toBe(true);
	});

	it("renders a plain bullet without a checkbox", () => {
		const { container } = render(
			<Markdown text={"- where the code lives\n"} />,
		);

		expect(container.querySelectorAll("li")).toHaveLength(1);
		expect(container.querySelector("input")).toBeNull();
	});

	it("folds a wrapped continuation line into the item above it", () => {
		const { container } = render(
			<Markdown
				text={"- [x] replace the outer details\n      with an article\n"}
			/>,
		);

		expect(container.querySelectorAll("li")).toHaveLength(1);
		expect(container.querySelector("li")?.textContent).toBe(
			"replace the outer details with an article",
		);
	});

	it("renders a fenced block as code, verbatim", () => {
		const { container } = render(
			<Markdown text={"```ts\nconst x = 1;\n```\n"} />,
		);

		expect(container.querySelector("pre code")?.textContent).toBe(
			"const x = 1;",
		);
	});

	it("still renders a fence nobody closed", () => {
		const { container } = render(<Markdown text={"```\narbor merge\n"} />);

		expect(container.querySelector("pre code")?.textContent).toBe(
			"arbor merge",
		);
	});

	it("renders inline code, bold and italics inside a line", () => {
		const { container } = render(
			<Markdown text={"run `arbor ls` for **every** *task*\n"} />,
		);

		expect(container.querySelector("code")?.textContent).toBe("arbor ls");
		expect(container.querySelector("strong")?.textContent).toBe("every");
		expect(container.querySelector("em")?.textContent).toBe("task");
	});

	it("links http destinations", () => {
		const { container } = render(
			<Markdown text={"open [the page](http://localhost:4269)"} />,
		);

		const link = container.querySelector("a");

		expect(link?.textContent).toBe("the page");
		expect(link?.getAttribute("href")).toBe("http://localhost:4269");
	});

	it("leaves a javascript: link as text rather than making it clickable", () => {
		const { container } = render(
			<Markdown text={"[click](javascript:alert(1))"} />,
		);

		expect(container.querySelector("a")).toBeNull();
		expect(container.textContent).toContain("[click](javascript:alert(1))");
	});

	it("renders markup in the source as text instead of elements", () => {
		const { container } = render(
			<Markdown text={"- [ ] drop <script>alert(1)</script>\n"} />,
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.querySelector("li")?.textContent).toBe(
			"drop <script>alert(1)</script>",
		);
	});
});

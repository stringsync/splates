import { afterEach, describe, expect, it } from "bun:test";
import { PageSection } from "./page-section";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("PageSection", () => {
	it("renders an uppercase muted h2 eyebrow and labels the section region from a string title", () => {
		const view = render(
			<PageSection title="Running">
				<p>Content</p>
			</PageSection>,
		);
		const region = view.getByRole("region", { name: "Running" });
		const heading = view.getByRole("heading", { level: 2, name: "Running" });

		expect(region.getAttribute("data-slot")).toBe("page-section");
		expect(region.className).toContain("flex");
		expect(region.className).toContain("min-w-0");
		expect(region.className).toContain("flex-col");
		expect(region.className).toContain("gap-3");
		expect(heading.className).toContain("text-xs");
		expect(heading.className).toContain("font-semibold");
		expect(heading.className).toContain("uppercase");
		expect(heading.className).toContain("tracking-wide");
		expect(heading.className).toContain("text-muted-foreground");
	});

	it("supports h3 headings and explicit region labels for non-string titles", () => {
		const view = render(
			<PageSection
				as="h3"
				label="mono"
				title={<span title="/work/mono">mono</span>}
			>
				<p>Models</p>
			</PageSection>,
		);
		expect(view.getByRole("region", { name: "mono" })).toBeDefined();
		expect(view.getByRole("heading", { level: 3, name: "mono" })).toBeDefined();
	});

	it("renders inline count (including zero), right-aligned aside, and description", () => {
		const view = render(
			<PageSection
				title="Kept"
				count={0}
				aside={<button type="button">Add</button>}
				description="In macOS Keychain. Values never come back to this page."
			>
				<p>List</p>
			</PageSection>,
		);
		const heading = view.getByRole("heading", { level: 2, name: "Kept" });
		const count = view.container.querySelector(
			'[data-slot="page-section-count"]',
		);
		const aside = view.container.querySelector(
			'[data-slot="page-section-aside"]',
		);
		const description = view.container.querySelector(
			'[data-slot="page-section-description"]',
		);

		expect(heading.textContent).toBe("Kept");
		expect(count?.textContent).toBe("0");
		expect(count?.className).toContain("tabular-nums");
		expect(aside?.className).toContain("ml-auto");
		expect(aside?.className).not.toContain("text-muted-foreground");
		expect(view.getByRole("button", { name: "Add" })).toBeDefined();
		expect(description?.textContent).toBe(
			"In macOS Keychain. Values never come back to this page.",
		);
	});

	it("styles plain string or number aside values in muted text", () => {
		const view = render(
			<PageSection title="Running" count={2} aside="2 active">
				<p>Runs</p>
			</PageSection>,
		);
		const aside = view.container.querySelector(
			'[data-slot="page-section-aside"] span',
		);
		expect(aside?.textContent).toBe("2 active");
		expect(aside?.className).toContain("text-muted-foreground");
		expect(aside?.className).toContain("text-xs");
	});

	it("supports description-only sections and headerless sections without empty aria-labels", () => {
		const withDescription = render(
			<PageSection description="Dev servers each project declares.">
				<p>Groups</p>
			</PageSection>,
		);
		const sectionWithDesc = withDescription.container.querySelector("section");
		expect(sectionWithDesc?.hasAttribute("aria-label")).toBe(false);
		expect(withDescription.queryByRole("heading")).toBeNull();
		expect(
			withDescription.container.querySelector(
				'[data-slot="page-section-description"]',
			)?.textContent,
		).toBe("Dev servers each project declares.");

		cleanup();

		const bare = render(
			<PageSection label="custom" className="mt-2">
				<p>Only body</p>
			</PageSection>,
		);
		const region = bare.getByRole("region", { name: "custom" });
		expect(
			region.querySelector('[data-slot="page-section-header"]'),
		).toBeNull();
		expect(region.className).toContain("mt-2");
	});
});

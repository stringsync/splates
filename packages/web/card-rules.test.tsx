import { afterEach, expect, test } from "bun:test";
import { BeforeAfter } from "./before-after";
import { CardBody } from "./card-shell";
import { ChecksSection } from "./checks-section";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

/** The aria-labels of the sections drawn with a rule above them. */
function ruled(container: HTMLElement): string[] {
	return [...container.querySelectorAll("section")]
		.filter((each) => each.className.includes("border-t"))
		.map((each) => each.getAttribute("aria-label") ?? "");
}

test("a card with a lead paragraph and no headers draws no rule", () => {
	const { container } = render(<CardBody text="Just a paragraph." />);
	expect(container.querySelectorAll("section")).toHaveLength(0);
});

test("a rule sits above each header's section after a lead, and not above the first without one", () => {
	const lead = render(
		<CardBody text={"Lead.\n\n## One\n\na\n\n## Two\n\nb"} />,
	);
	expect(ruled(lead.container)).toEqual(["One", "Two"]);
	cleanup();
	const bare = render(<CardBody text={"## One\n\na\n\n## Two\n\nb"} />);
	expect(ruled(bare.container)).toEqual(["Two"]);
});

test("the merged card has one rule between Before, After and Checks each", () => {
	const { container } = render(
		<BeforeAfter record={{ before: "Was.", after: "Is." }} folds>
			<ChecksSection text="- [x] Tests pass" />
		</BeforeAfter>,
	);
	expect(ruled(container)).toEqual(["after", "checks"]);
});

test("a card whose only readout is a d2 diagram draws the diagram, not plain code", () => {
	const { container } = render(
		<CardBody text={"Flow:\n\n```d2\na -> b\n```"} />,
	);
	// The diagram view's source fallback carries a border; markdown code does not.
	expect(container.querySelector("pre.border")).not.toBeNull();
});

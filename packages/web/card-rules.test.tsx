import { afterEach, expect, test } from "bun:test";
import { BeforeAfter } from "./before-after";
import { BlockersCard } from "./blockers-card";
import { Board, NO_BOARD } from "./board";
import { CardBody } from "./card-shell";
import { ChecksSection } from "./checks-section";
import { details, todo } from "./fixtures";
import { LiveMergeCard } from "./merge-card";
import { OwnQueueCard } from "./permission-card";
import { ReviewPanel } from "./review-panel";
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
	expect(lead.getByText("Lead.").closest("div")?.className).toContain("pb-5");
	expect(lead.getByText("Lead.").closest("div")?.className).toContain(
		"@max-md:pb-5",
	);
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

test("a card body draws a d2 fence as a diagram, not plain code", () => {
	const { container } = render(
		<CardBody text={"Flow:\n\n```d2\na -> b\n```"} />,
	);
	// The diagram view's source fallback carries a border; markdown code does not.
	expect(container.querySelector("pre.border")).not.toBeNull();
});

test("a Ready to merge card joins summary and details without a divider between them", () => {
	const { container } = render(
		<ReviewPanel
			review={{
				task: "header",
				base: "main",
				summary: "Opening line:",
				checks: [],
				failed: [],
				details: "- One\n- Two",
			}}
		/>,
	);
	expect(
		container.querySelectorAll(".divide-y, .border-t, .rule-y, .rule-t"),
	).toHaveLength(0);
});

test("a live merge card's batch banner draws no rule directly under the header", () => {
	const { container } = render(
		<LiveMergeCard
			conversation="c1"
			task={details({
				task: "a",
				mergeBatch: ["a", "b"],
				mergeSteps: {
					steps: [{ step: "rebase", at: "2026-01-01T00:00:00.000Z" }],
				},
				mergeSince: "2026-01-01T00:00:00.000Z",
			})}
		/>,
	);
	expect(ruled(container)).not.toContain("Batch");
});

test("a queue card with no body draws no divider directly under the header", () => {
	const first = todo({ id: 1, subject: "First task" });
	const { container } = render(
		<Board.Provider value={{ ...NO_BOARD, linked: true, todos: [first] }}>
			<OwnQueueCard
				proposal={{
					action: "queue",
					lane: null,
					tasks: [1],
					title: "tasks added in this conversation",
					body: "",
				}}
			/>
		</Board.Provider>,
	);
	// Only the action footer at the bottom carries a rule, not the panel directly under the header.
	expect(
		container
			.querySelector("ul")
			?.parentElement?.className.match(/\b(border|rule)-t\b/) != null,
	).toBe(false);
	expect(container.querySelectorAll("div.border-t, div.rule-t")).toHaveLength(
		1,
	);
});

test("a blockers card with no why text draws no divider on its first blocker under the header", () => {
	const blocker = todo({ id: 1, subject: "First blocker" });
	const blocked = todo({ id: 2, subject: "Blocked task", blockedBy: [1] });
	const { container } = render(
		<Board.Provider
			value={{ ...NO_BOARD, linked: true, todos: [blocker, blocked] }}
		>
			<BlockersCard task={blocked} label="blocked" />
		</Board.Provider>,
	);
	const firstRow = container.querySelector("ol[aria-label='blockers'] > li");
	expect(firstRow).not.toBeNull();
	expect(
		container
			.querySelector("ol[aria-label='blockers']")
			?.className.includes("[&>li:first-child]:border-t-0"),
	).toBe(true);
});

test("an empty queue card draws no footer rule directly under the header", () => {
	const { container } = render(
		<Board.Provider value={{ ...NO_BOARD, linked: true, todos: [] }}>
			<OwnQueueCard
				proposal={{
					action: "queue",
					lane: null,
					tasks: [99],
					title: "missing task",
					body: "",
				}}
			/>
		</Board.Provider>,
	);
	expect(container.querySelectorAll(".border-t, .rule-t")).toHaveLength(0);
});

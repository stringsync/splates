import { afterEach, describe, expect, it } from "bun:test";
import { Board, NO_BOARD } from "./board";
import { SplatesEvent, type SplatesEventView } from "./splates-event";
import { cleanup, fireEvent, render, within } from "./testing-library";

afterEach(cleanup);

/** An ISO time `mins` minutes from now. */
function at(mins: number): string {
	return new Date(Date.now() + mins * 60_000).toISOString();
}

const merged: SplatesEventView = {
	words: [
		"Merged",
		{ kind: "task", task: "events-log" },
		"onto",
		{ kind: "branch", branch: "main" },
	],
	at: at(0),
};

describe("splates events", () => {
	it("says what splates did and names what it did it to", () => {
		const page = render(<SplatesEvent event={merged} />);

		const event = page.getByRole("note", { name: "splates" });
		expect(event.textContent).toContain("Merged");
		expect(within(event).getByTitle("Task events-log")).toBeDefined();
		expect(within(event).queryByTitle("Branch main")).toBeNull();
	});

	it("keeps a wait to its subject without inline timing", () => {
		const page = render(
			<SplatesEvent
				event={{
					words: ["Waiting on", { kind: "task", task: "events-log" }],
					at: at(-1),
					deadline: { until: at(4) },
				}}
			/>,
		);

		const event = page.getByRole("note", { name: "splates" });
		expect(event.dataset.live).toBe("true");
		expect(event.textContent).toBe("Waiting onevents-log");
		expect(page.queryByRole("button", { name: "Paste" })).toBeNull();
	});

	it("leads with a red X for a command that failed", () => {
		const page = render(
			<SplatesEvent
				event={{
					...merged,
					mark: "failed",
					words: ["Merge failed", { kind: "task", task: "events-log" }],
				}}
			/>,
		);

		expect(page.getByLabelText("Failed").getAttribute("class")).toContain(
			"text-destructive",
		);
	});

	it("leads with a green check for a command that landed", () => {
		const page = render(<SplatesEvent event={{ ...merged, mark: "landed" }} />);

		expect(page.getByLabelText("Landed").getAttribute("class")).toContain(
			"text-success",
		);
	});

	it("leads with no mark of its own unless given one", () => {
		const page = render(<SplatesEvent event={merged} />);

		const event = page.getByRole("note", { name: "splates" });
		// One icon in each of its two chips, and none before them.
		expect(event.querySelectorAll("svg")).toHaveLength(1);
		expect(event.querySelector("p > svg")).toBeNull();
	});

	it("opens the Creds page from a cred's chip", () => {
		const page = render(
			<SplatesEvent
				event={{
					...merged,
					words: ["Requested", { kind: "cred", name: "API_TOKEN" }],
				}}
			/>,
		);

		expect(page.getByTitle("Cred API_TOKEN").getAttribute("href")).toBe(
			"#creds/API_TOKEN",
		);
	});

	it("runs its one action", () => {
		let runs = 0;
		const page = render(
			<SplatesEvent
				event={{ ...merged, act: { label: "Paste", run: () => runs++ } }}
			/>,
		);

		fireEvent.click(page.getByRole("button", { name: "Paste" }));

		expect(runs).toBe(1);
		expect(page.queryByTitle("Task events-log")).toBeNull();
	});

	it("says its action is done in place of the button", () => {
		const page = render(
			<SplatesEvent
				event={{
					...merged,
					act: { label: "Paste", run: () => {}, done: "Saved" },
				}}
			/>,
		);

		expect(page.queryByRole("button", { name: "Paste" })).toBeNull();
		expect(page.getByText("Saved")).toBeDefined();
	});

	it("opens the board narrowed to a burst's todos from its chip", () => {
		const opened: (readonly number[])[] = [];
		const page = render(
			<Board
				value={{
					...NO_BOARD,
					linked: true,
					openTodos: (ids) => opened.push(ids),
				}}
			>
				<SplatesEvent
					event={{
						...merged,
						words: [
							"Updated",
							{
								kind: "todos",
								todos: [
									{ id: 212, subject: "one" },
									{ id: 214, subject: "two" },
								],
							},
						],
					}}
				/>
			</Board>,
		);

		fireEvent.click(page.getByTitle("Tasks #212, #214"));

		expect(opened).toEqual([[212, 214]]);
	});

	it("names a burst of todos as one chip without expanding its list", () => {
		const page = render(
			<SplatesEvent
				event={{
					...merged,
					words: [
						"Updated",
						{
							kind: "todos",
							todos: [
								{ id: 212, subject: "Upload retries forever on a 413" },
								{ id: 214, subject: "Show a stale todo as muted" },
							],
						},
					],
				}}
			/>,
		);

		expect(page.getByTitle("Tasks #212, #214").textContent).toBe("2 tasks");
		expect(
			page.queryByTitle("Task #212: Upload retries forever on a 413"),
		).toBeNull();
	});

	it("goes once what its wait waited on came", () => {
		const page = render(
			<SplatesEvent
				event={{ ...merged, deadline: { until: at(4), met: true } }}
			/>,
		);

		expect(page.queryByRole("note", { name: "splates" })).toBeNull();
	});
});

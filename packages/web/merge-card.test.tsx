import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Event } from "@stringsync/splates-server/records";
import type { Details } from "@stringsync/splates-server/tasks";
import { details } from "./fixtures";
import { EndedMergeCard, LiveMergeCard, WatchMerge } from "./merge-card";
import type { WatchMergeStep } from "./side-panes";
import { cleanup, fireEvent, render, within } from "./testing-library";

describe("merge cards", () => {
	let merging: Details;
	let watched: Parameters<WatchMergeStep>[0][];

	beforeEach(() => {
		watched = [];
		merging = details({
			task: "alpha",
			base: "main",
			gate: "running",
			mergeSince: ago(125),
			mergeSteps: {
				steps: [
					{ step: "rebase", at: ago(125) },
					{ step: "check", at: ago(120), output: "/g/1-check.log" },
					{ step: "wait", at: ago(90) },
					{ step: "test", at: ago(60), output: "/g/3-test.log" },
				],
				phases: [
					{ phase: "biome", at: ago(58), ms: 4000 },
					{ phase: "tests", at: ago(50) },
				],
			},
		});
	});

	afterEach(cleanup);

	/** `merging`'s card, on a page with a pane to open its steps' output in or without. */
	const live = (paned: boolean) =>
		render(
			<WatchMerge value={paned ? (step) => watched.push(step) : null}>
				<LiveMergeCard conversation="c1" task={merging} />
			</WatchMerge>,
		);

	it("lays a merge under way on a rail, the premerge's phases under it, and opens what a command step printed", () => {
		const view = live(true);
		const card = view.getByRole("region", { name: "Merge" });

		expect(card.textContent).toContain("Merging");
		expect(card.textContent).toContain("2m 5s");
		expect(labels(card)).toEqual([
			"Rebase onto main, done",
			"Checks before the line, done",
			"Wait for its turn, done",
			"Premerge, under way",
			"biome, done",
			"tests, under way",
			"Land on main, to come",
			"Clean up, to come",
		]);

		const opens = within(card).getAllByRole("button", {
			name: /Checks before the line|Premerge/,
		});
		expect(opens).toHaveLength(2);
		fireEvent.click(opens[1] as HTMLElement);
		expect(watched).toEqual([
			{ conversation: "c1", task: "alpha", index: 3, label: "Premerge" },
		]);
	});

	it("opens nothing where the page has no pane", () => {
		const view = live(false);

		expect(view.queryByRole("button")).toBeNull();
	});

	it("folds a landed merge to its time, opening to the steps it took and its premerge's phases", () => {
		const view = render(<EndedMergeCard end={ended(null)} ms={140_000} />);
		const card = view.getByRole("region", { name: "Merge" });

		expect(card.textContent).toContain("Merged in 2m 20s");
		expect(within(card).queryByRole("list")).toBeNull();

		fireEvent.click(within(card).getByText("Merged in 2m 20s"));
		expect(labels(card)).toEqual([
			"Rebase onto main, done",
			"Checks before the line, done",
			"Premerge, done",
			"biome, done",
			"tests, done",
			"half 1, done",
		]);
	});

	it("shows a refused merge open, marking the step it failed at, with Why", () => {
		const view = render(
			<EndedMergeCard end={ended("tests_failed")} ms={140_000} />,
		);
		const card = view.getByRole("region", { name: "Merge" });

		expect(card.textContent).toContain("Merge failed in 2m 20s");
		expect(
			within(card).getByRole("listitem", { name: "Premerge, failed" }),
		).toBeTruthy();
		// The gate stops in the phase that failed, the last it ran.
		expect(
			within(card).getByRole("listitem", { name: "tests, failed" }),
		).toBeTruthy();
		expect(within(card).getByRole("button", { name: "Why" })).toBeTruthy();
	});
});

function ago(secs: number): string {
	return new Date(Date.now() - secs * 1000).toISOString();
}

/** The steps and phases `card` lists, by what each says of itself. */
function labels(card: HTMLElement): (string | null)[] {
	return within(within(card).getByRole("list", { name: "Merge steps" }))
		.getAllByRole("listitem")
		.map((item) => item.getAttribute("aria-label"));
}

/** A merge event that kept its steps, refused for `reason` or landed. */
function ended(reason: string | null): Extract<Event, { action: "merge" }> {
	return {
		id: "m1",
		at: ago(0),
		action: "merge",
		task: "alpha",
		reason,
		conversation: "c1",
		base: "main",
		commit: "abc1234",
		files: [],
		attemptsLeft: 2,
		failedTests: [],
		stepsMs: { rebase: 4000, check: 38_000, test: 97_000 },
		gate: {
			workers: 4,
			load: 1,
			ms: { setup: 2000, biome: 3000, tests: 71_000, "half 1": 58_000 },
			within: { "half 1": "tests" },
		},
	} as Extract<Event, { action: "merge" }>;
}

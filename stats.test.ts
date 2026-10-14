import { describe, expect, it } from "bun:test";
import type { Outcome } from "./outcomes";
import { summarize } from "./stats";

/** An outcome that ended cleanly; a test overrides what it is about. */
function ended(changes: Partial<Outcome>): Outcome {
	return {
		project: "/repo",
		task: "alpha",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-12T09:00:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: "Opus 5.5",
		...changes,
	};
}

// A Wednesday: its week starts on Monday the 12th.
const now = new Date("2026-10-14T12:00:00.000Z");

describe("summarize", () => {
	it("sums each week, those with nothing ended included, oldest first", () => {
		const stats = summarize(
			[
				ended({ endedAt: "2026-10-05T08:00:00.000Z", questionRounds: 2 }),
				ended({ endedAt: "2026-10-12T00:00:00.000Z" }),
				ended({ ended: "removed", questionRounds: 1, failedMerges: 2 }),
				ended({ questionRounds: 1, reviewRounds: 1 }),
			],
			{ weeks: 3, now },
		);

		expect(stats.weeks).toMatchObject([
			{
				start: "2026-09-28",
				merged: 0,
				removed: 0,
				clean: 0,
				questionRounds: 0,
				reviewRounds: 0,
				failedMerges: 0,
			},
			{
				start: "2026-10-05",
				merged: 1,
				removed: 0,
				clean: 0,
				questionRounds: 2,
				reviewRounds: 0,
				failedMerges: 0,
			},
			{
				start: "2026-10-12",
				merged: 2,
				removed: 1,
				clean: 1,
				questionRounds: 2,
				reviewRounds: 1,
				failedMerges: 2,
			},
		]);
		expect(stats.since).toBe("2026-10-05T08:00:00.000Z");
	});

	it("sums the as many weeks before to compare with, and counts only the period by model", () => {
		const stats = summarize(
			[
				ended({ endedAt: "2026-09-29T08:00:00.000Z", questionRounds: 3 }),
				ended({ endedAt: "2026-10-06T08:00:00.000Z", model: "Sonnet 5.5" }),
				ended({}),
			],
			{ weeks: 1, now },
		);

		expect(stats.weeks.map((week) => week.start)).toEqual(["2026-10-12"]);
		expect(stats.previous).toMatchObject({ merged: 1, questionRounds: 0 });
		expect(stats.models).toMatchObject([{ model: "Opus 5.5", merged: 1 }]);
	});

	it("runs all time from the week the first task ended, with nothing before", () => {
		const stats = summarize(
			[ended({ endedAt: "2026-09-29T08:00:00.000Z" }), ended({})],
			{ weeks: null, now },
		);

		expect(stats.weeks.map((week) => week.start)).toEqual([
			"2026-09-28",
			"2026-10-05",
			"2026-10-12",
		]);
		expect(stats.previous).toBeNull();
		expect(stats.models).toMatchObject([{ merged: 2 }]);
	});

	it("groups by model and project, the most tasks first", () => {
		const stats = summarize(
			[
				ended({ model: null, project: "/other" }),
				ended({ model: "Sonnet 5.5" }),
				ended({ model: "Sonnet 5.5", ended: "removed" }),
			],
			{ now },
		);

		expect(stats.models).toMatchObject([
			{ model: "Sonnet 5.5", merged: 1, removed: 1 },
			{ model: null, merged: 1 },
		]);
		expect(stats.projects).toMatchObject([
			{ project: "/repo", merged: 1, removed: 1 },
			{ project: "/other", merged: 1 },
		]);
	});

	it("leaves parts out, since their caller is counted", () => {
		const stats = summarize([ended({ base: "task/parent" })], { now });

		expect(stats.models).toEqual([]);
		expect(stats.since).toBeNull();
	});

	it("sums picks, waits, failures and removals, and counts a task in each system it touched", () => {
		const stats = summarize(
			[
				ended({
					systems: ["mixer", "docs"],
					picksAsked: 3,
					picksOverturned: 1,
					picksAmended: 1,
					waitedMs: 1000,
					startedAt: "2026-10-14T09:59:50.000Z",
					failedMergesBy: { conflict: 2 },
				}),
				ended({ ended: "removed", removedFor: "redo", systems: [] }),
				// Written before any of it was kept.
				ended({ ended: "removed" }),
			],
			{ now },
		);

		expect(stats.weeks.at(-1)).toMatchObject({
			picksAsked: 3,
			picksOverturned: 1,
			picksAmended: 1,
			timed: 1,
			waitedMs: 1000,
			spentMs: 10_000,
			failedBy: { conflict: 2, tests_failed: 0, merge_failed: 0 },
			removedFor: { redo: 1, unsaid: 1, moot: 0 },
		});
		expect(stats.systems).toMatchObject([
			{ system: null, merged: 0, removed: 2 },
			{ system: "mixer", merged: 1 },
			{ system: "docs", merged: 1 },
		]);
	});
});

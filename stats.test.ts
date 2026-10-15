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

// A Wednesday, on the hour: its week starts on Monday the 12th.
const now = new Date("2026-10-14T12:00:00.000Z");

describe("summarize", () => {
	it("sums each bar, those with nothing ended included, oldest first", () => {
		const stats = summarize(
			[
				ended({ endedAt: "2026-10-14T06:10:00.000Z", questionRounds: 2 }),
				ended({ endedAt: "2026-10-14T11:00:00.000Z" }),
				ended({
					endedAt: "2026-10-14T11:59:00.000Z",
					ended: "removed",
					questionRounds: 1,
					failedMerges: 2,
				}),
			],
			{ period: "6h", now: new Date("2026-10-14T12:20:00.000Z") },
		);

		expect(stats.buckets.map((bucket) => bucket.start)).toEqual(
			Array.from({ length: 12 }, (_, index) =>
				new Date(
					Date.parse("2026-10-14T06:30:00.000Z") + index * 30 * 60 * 1000,
				).toISOString(),
			),
		);
		expect(stats.buckets.at(-2)).toMatchObject({
			merged: 0,
			removed: 1,
			questionRounds: 1,
			failedMerges: 2,
		});
		expect(stats.buckets.at(-3)).toMatchObject({ merged: 1, clean: 1 });
		// Before the first bar, so it is the span before.
		expect(stats.previous).toMatchObject({ merged: 1, questionRounds: 2 });
		expect(stats.since).toBe("2026-10-14T06:10:00.000Z");
	});

	it("cuts each period into bars of its own length", () => {
		const bars = (period: "1d" | "3d" | "7d") => {
			const { buckets } = summarize([], { period, now });
			return [buckets.length, buckets.at(-1)?.start];
		};

		expect(bars("1d")).toEqual([24, "2026-10-14T12:00:00.000Z"]);
		expect(bars("3d")).toEqual([24, "2026-10-14T12:00:00.000Z"]);
		expect(bars("7d")).toEqual([28, "2026-10-14T12:00:00.000Z"]);
	});

	it("sums as long a span before to compare with, and counts only the period by model", () => {
		const stats = summarize(
			[
				ended({ endedAt: "2026-10-12T08:00:00.000Z", questionRounds: 3 }),
				ended({ endedAt: "2026-10-13T08:00:00.000Z", model: "Sonnet 5.5" }),
				ended({}),
			],
			{ period: "1d", now },
		);

		expect(stats.previous).toMatchObject({ merged: 1, questionRounds: 0 });
		expect(stats.models).toMatchObject([{ model: "Opus 5.5", merged: 1 }]);
	});

	it("runs all time a bar a week from the week the first task ended, with nothing before", () => {
		const stats = summarize(
			[ended({ endedAt: "2026-09-29T08:00:00.000Z" }), ended({})],
			{ period: "all", now },
		);

		expect(stats.buckets.map((bucket) => bucket.start)).toEqual([
			"2026-09-28T00:00:00.000Z",
			"2026-10-05T00:00:00.000Z",
			"2026-10-12T00:00:00.000Z",
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

		expect(
			stats.buckets.find((bucket) => bucket.merged + bucket.removed > 0),
		).toMatchObject({
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

	it("rates each skill check by the conversations it passed in, newest version first", () => {
		const scored = (
			conversation: string,
			skill: string | null,
			failed: number,
		) => ({
			conversation,
			project: "/repo",
			agent: "claude",
			skill,
			at: "2026-10-14T10:00:00.000Z",
			scores: { "added-card": { passed: 1, failed } },
		});

		const { skill } = summarize([], {
			judged: [
				scored("a", "0.0.9", 0),
				scored("b", null, 0),
				scored("c", "0.0.10", 1),
				scored("d", "0.0.10", 0),
			],
		});

		expect(
			skill.map((each) => [
				each.skill,
				each.conversations,
				each.checks.find((check) => check.id === "added-card"),
			]),
		).toEqual([
			["0.0.10", 2, expect.objectContaining({ applied: 2, passed: 1 })],
			["0.0.9", 1, expect.objectContaining({ applied: 1, passed: 1 })],
			[null, 1, expect.objectContaining({ applied: 1, passed: 1 })],
		]);
		expect(skill[0]?.checks.find((check) => check.id === "squashed")).toEqual(
			expect.objectContaining({ applied: 0, passed: 0 }),
		);
	});
});

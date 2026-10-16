import { describe, expect, it } from "bun:test";
import type { Outcome } from "./outcomes";
import { combine, summarize } from "./stats";

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

	it("groups by where the person worked each task from", () => {
		const stats = summarize(
			[
				ended({ promptsFrom: { phone: 3 } }),
				ended({ promptsFrom: { phone: 1, desktop: 2 } }),
				ended({ promptsFrom: { desktop: 1 }, ended: "removed" }),
				ended({ promptsFrom: { phone: 0, desktop: 4 } }),
				ended({}),
			],
			{ now },
		);

		expect(stats.devices).toMatchObject([
			{ device: "desktop", merged: 1, removed: 1 },
			{ device: "phone", merged: 1 },
			{ device: "both", merged: 1 },
			{ device: null, merged: 1 },
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
			scores: { "plan-first": { passed: 1, failed } },
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
				each.checks.find((check) => check.id === "plan-first"),
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

	it("totals cost, tokens, working time and lines over the tasks that kept them", () => {
		const stats = summarize(
			[
				ended({
					usage: {
						input: 100,
						cached: 50,
						output: 10,
						cost: { amount: 1.5, currency: "USD" },
					},
					workedMs: 60_000,
					size: { files: 2, added: 30, removed: 5 },
				}),
				// Codex says no cost.
				ended({
					usage: { input: 40, cached: 0, output: 4, cost: null },
					workedMs: 1000,
				}),
				ended({}),
			],
			{ period: "1d", now },
		);

		expect(stats.buckets.at(-3)).toMatchObject({
			used: 2,
			inputTokens: 140,
			outputTokens: 14,
			costed: 1,
			cost: 1.5,
			workedMs: 61_000,
			sized: 1,
			filesChanged: 2,
			linesAdded: 30,
			linesRemoved: 5,
		});
		expect(stats.baselines).toMatchObject([{ project: "/repo", tasks: 3 }]);
	});

	it("counts who made each size's calls in scheme order, older outcomes as unsized", () => {
		const stats = summarize(
			[
				ended({
					decisions: [
						{
							number: "1",
							text: "A?",
							size: "large",
							how: "asked",
							ended: "overturned",
						},
						{
							number: "2",
							text: "B?",
							size: "small",
							how: "assumed",
							ended: "kept",
						},
						{
							number: "3",
							text: "C?",
							size: "large",
							how: "asked",
							ended: "kept",
						},
						{
							number: "4",
							text: "D?",
							size: "tiny",
							how: "assumed",
							ended: "challenged",
						},
					],
				}),
				// Written before decisions were kept: its counts read back unsized.
				ended({
					questionsAsked: 4,
					picksAsked: 2,
					picksAmended: 1,
					assumptionsMade: 3,
					assumptionsChallenged: 1,
				}),
			],
			{ now },
		);
		expect(stats.sizes).toMatchObject([
			{ size: "small", decidedByYou: 0, decidedByAgents: 1 },
			{ size: "large", decidedByYou: 2, decidedByAgents: 0 },
			// A challenged assumption took the person's attention.
			{ size: "tiny", decidedByYou: 1, decidedByAgents: 0 },
			// Every question put to them, picked or not, and the challenge.
			{ size: null, decidedByYou: 4, decidedByAgents: 2 },
		]);
		// Each size's bars line up with the period's: its call sits in the bar
		// the task ended in.
		const bar = stats.buckets.findIndex((each) => each.decidedByAgents > 0);
		expect(stats.sizes[0]?.buckets).toHaveLength(stats.buckets.length);
		expect(stats.sizes[0]?.buckets[bar]).toEqual({
			decidedByYou: 0,
			decidedByAgents: 1,
		});
		expect(combine(stats.buckets)).toMatchObject({
			decidedByYou: 7,
			decidedByAgents: 3,
		});
	});
});

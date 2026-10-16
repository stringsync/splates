import { describe, expect, it } from "bun:test";
import type { Outcome } from "../outcomes";
import type { Decision } from "../plan";
import { deferred, type Fact, mergedFacts } from "./merged-facts";

describe("mergedFacts", () => {
	// scry-ignore simple-test-setup: each test builds the outcome it reads, which is its input, not shared setup
	it("defers a finding as the card says it, with the data it came from", () => {
		const stopped = {
			kind: "stopped",
			at: "2026-10-14T09:30:00.000Z",
		} as const;
		const facts = mergedFacts({
			outcome: merged({
				findings: [
					{ kind: "gate", reason: "conflict", at: "", files: ["a.ts"] },
					stopped,
				],
			}),
			baseline: null,
		});

		expect(deferred("alpha", facts.findings[0] as Fact)).toEqual({
			subject: "You stopped a turn",
			text: [
				"Found in `alpha` as it merged: You stopped a turn.",
				"",
				"```json",
				JSON.stringify(stopped, null, 2),
				"```",
			].join("\n"),
		});
	});

	it("says each figure, marking one far above its project's usual", () => {
		const facts = mergedFacts({
			outcome: merged({
				workedMs: 20 * MINUTE,
				waitedMs: 10 * MINUTE,
				usage: {
					input: 4_200_000,
					cached: 0,
					output: 31_500,
					cost: { amount: 4.5, currency: "USD" },
				},
				size: { files: 3, added: 120, removed: 30 },
				decisions: [
					decision("1", "large", "asked", "overturned"),
					decision("2", "small", "assumed", "kept"),
					decision("3", null, "assumed", "kept"),
					decision("4", "small", "assumed", "challenged"),
					decision("5", "medium", "assumed", "kept"),
				],
			}),
			baseline: {
				project: "/repo",
				tasks: 10,
				measures: {
					spentMs: { tasks: 10, median: 30 * MINUTE, p90: 60 * MINUTE },
					cost: { tasks: 10, median: 1, p90: 3 },
					lines: { tasks: 10, median: 200, p90: 400 },
					decidedByYou: { tasks: 10, median: 1, p90: 2 },
					failedMerges: { tasks: 10, median: 0, p90: 0 },
				},
				findings: {},
			},
		});

		expect(facts.stats).toEqual([
			{
				label: "Time",
				value: "40m",
				detail: "worked 20m · waited 10m",
				high: false,
			},
			{
				label: "Cost",
				value: "$4.50",
				detail: "4.2M in · 31.5k out",
				high: true,
			},
			{
				label: "Size",
				value: { added: 120, removed: 30 },
				detail: "3 files",
				high: false,
			},
			{
				label: "Decisions",
				value: { byYou: 2, byAgent: 3 },
				detail: null,
				high: false,
			},
		]);
		expect(facts.gate).toBeNull();
	});

	it("lists the gate's failures, then the other findings most severe first, each with how often it came up", () => {
		const facts = mergedFacts({
			outcome: merged({
				failedMerges: 1,
				findings: [
					{ kind: "gate", reason: "tests_failed", at: "", tests: ["adds up"] },
					{ kind: "gate", reason: "budget_exhausted", at: "" },
					{ kind: "retried", times: 1 },
					{ kind: "churn", edited: 900, landed: 40 },
					{ kind: "stopped", at: "" },
				],
			}),
			baseline: {
				project: "/repo",
				tasks: 4,
				measures: {
					spentMs: null,
					cost: null,
					lines: null,
					decidedByYou: null,
					failedMerges: null,
				},
				findings: { "gate:tests_failed:adds up": 3, stopped: 1 },
			},
		});

		expect(facts.gate).toMatchObject([
			{ text: "Tests failed: adds up", again: "3rd time this week" },
			{ text: "Ran out of merge attempts", again: null },
			{ text: "Given more attempts once", again: null },
		]);
		expect(facts.findings).toMatchObject([
			{ text: "You stopped a turn", again: null },
			{ text: "Edited 900 lines to land 40", again: null },
		]);
		expect(facts.stats.map((stat) => stat.high)).toEqual([false]);
	});

	it("says tokens for an agent that tells no cost, and only the failures an older outcome counted", () => {
		const facts = mergedFacts({
			outcome: merged({
				usage: { input: 1, cached: 0, output: 12_300, cost: null },
				failedMerges: 2,
			}),
			baseline: null,
		});

		expect(facts.stats[1]).toMatchObject({
			label: "Tokens",
			value: "1 in · 12.3k out",
		});
		expect(facts.gate).toEqual([
			{ text: "Failed to merge twice", again: null, finding: null },
		]);
		expect(facts.findings).toEqual([]);
	});

	it("says nothing of usage a task merged in its first turn never kept, nor calls an older outcome never kept", () => {
		const facts = mergedFacts({
			outcome: merged({
				usage: { input: 0, cached: 0, output: 0, cost: null },
				assumptionsMade: 0,
			}),
			baseline: null,
		});
		const older = mergedFacts({ outcome: merged({}), baseline: null });

		expect(facts.stats.map((stat) => stat.label)).toEqual([
			"Time",
			"Decisions",
		]);
		expect(facts.stats[1]?.value).toEqual({ byYou: 0, byAgent: 0 });
		expect(older.stats.map((stat) => stat.label)).toEqual(["Time"]);
	});
});

const MINUTE = 60_000;

function decision(
	number: string,
	size: Decision["size"],
	how: Decision["how"],
	ended: Decision["ended"],
): Decision {
	return { number, text: `Call ${number}`, size, how, ended };
}

/** A merged task 40 minutes long; a test overrides what it is about. */
function merged(changes: Partial<Outcome>): Outcome {
	return {
		project: "/repo",
		task: "alpha",
		base: "main",
		ended: "merged",
		startedAt: "2026-10-14T09:20:00.000Z",
		endedAt: "2026-10-14T10:00:00.000Z",
		questionRounds: 0,
		reviewRounds: 0,
		failedMerges: 0,
		conversation: null,
		agent: null,
		model: null,
		...changes,
	};
}

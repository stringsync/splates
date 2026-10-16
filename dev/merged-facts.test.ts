import { describe, expect, it } from "bun:test";
import type { Outcome } from "../outcomes";
import {
	deferred,
	deferredLeft,
	type Fact,
	investigation,
	mergedFacts,
} from "./merged-facts";

describe("mergedFacts", () => {
	// scry-ignore simple-test-setup: each test builds the outcome it reads, which is its input, not shared setup
	it("asks Investigate of every finding as the card says it, with the data each came from", () => {
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

		const asked = investigation("alpha", facts);

		expect(asked.split("\n").slice(0, 4)).toEqual([
			"[ARBOR INVESTIGATE alpha]",
			"",
			"- Conflicted in a.ts",
			"- You stopped a turn",
		]);
		expect(asked).toContain('"kind": "stopped"');
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
		expect(
			deferredLeft("alpha", "`bun test` keeps failing: it needs a browser"),
		).toEqual({
			subject: "bun test keeps failing",
			text: "Left unfixed when `alpha`'s findings were investigated: `bun test` keeps failing: it needs a browser",
		});
	});

	it("says each figure beside its project's median, marking one far above it", () => {
		const facts = mergedFacts({
			outcome: merged({
				workedMs: 20 * MINUTE,
				waitedMs: 10 * MINUTE,
				usage: {
					input: 1,
					cached: 0,
					output: 1,
					cost: { amount: 4.5, currency: "USD" },
				},
				size: { files: 3, added: 120, removed: 30 },
				questionRounds: 1,
			}),
			baseline: {
				project: "/repo",
				tasks: 10,
				measures: {
					spentMs: { tasks: 10, median: 30 * MINUTE, p90: 60 * MINUTE },
					cost: { tasks: 10, median: 1, p90: 3 },
					lines: { tasks: 10, median: 200, p90: 400 },
					involvement: { tasks: 10, median: 1, p90: 2 },
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
				median: "30m",
				high: false,
			},
			{
				label: "Cost",
				value: "$4.50",
				detail: null,
				median: "$1.00",
				high: true,
			},
			{
				label: "Size",
				value: { added: 120, removed: 30 },
				detail: "3 files",
				median: "200 lines",
				high: false,
			},
			{
				label: "Asked you",
				value: "once",
				detail: null,
				median: "once",
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
					involvement: null,
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
		expect(facts.stats.map((stat) => stat.median)).toEqual([null, null]);
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
			value: "12.3k out",
		});
		expect(facts.gate).toEqual([
			{ text: "Failed to merge twice", again: null, finding: null },
		]);
		expect(facts.findings).toEqual([]);
	});
});

const MINUTE = 60_000;

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

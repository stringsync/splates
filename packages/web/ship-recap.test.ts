import { describe, expect, test } from "bun:test";
import type { RunState, StepState } from "@splates/server/ship";
import { typicalKey } from "./ship-estimates";
import { flag, outcome } from "./ship-recap";

const step = (over: Partial<StepState>): StepState => ({
	id: "publish",
	does: "",
	dependencies: [],
	status: "done",
	output: [],
	prompts: [],
	started: 0,
	ended: 10_000,
	...over,
});

const runOf = (each: StepState): RunState =>
	({
		id: "run-1",
		targets: [{ name: "lib", steps: [each] }],
	}) as unknown as RunState;

describe("the recap's flagged steps", () => {
	test("flags a retried or fixed step and says how it ended", () => {
		const retried = step({ retries: 1, failure: "npm 403" });
		expect(flag(runOf(retried), new Map()).map((each) => each.trouble)).toEqual(
			[true],
		);
		expect(outcome(retried)).toBe("retried once, then passed");
		expect(
			outcome(step({ fix: { task: 812, at: 1, ended: "merged" }, retries: 1 })),
		).toBe("agent fix #812 merged, then passed");
		expect(outcome(step({ status: "failed" }))).toBe("still failing");
	});

	test("flags a step slow only at 1.5x and 30s over its usual time", () => {
		const estimates = new Map([[typicalKey("lib", "publish"), 100_000]]);
		const slowAt = (took: number) =>
			flag(runOf(step({ ended: took })), estimates).length;
		expect(slowAt(149_000)).toBe(0);
		expect(slowAt(150_000)).toBe(1);
		const quick = new Map([[typicalKey("lib", "publish"), 10_000]]);
		expect(flag(runOf(step({ ended: 29_000 })), quick)).toEqual([]);
		expect(flag(runOf(step({ ended: 29_000 })), new Map())).toEqual([]);
	});
});

import { beforeEach, describe, expect, test } from "bun:test";
import {
	createEvalLoop,
	type EvalLoop,
	type LoopCompletion,
	type LoopContract,
	type LoopEvent,
	type LoopResult,
	transitionEvalLoop,
} from "./loop";

describe("eval improvement loops", () => {
	let initial: EvalLoop;
	let diagnosed: EvalLoop;
	let editing: EvalLoop;
	let awaiting: EvalLoop;
	let running: EvalLoop;
	beforeEach(() => {
		initial = createEvalLoop(contract, "base");
		diagnosed = baseline();
		editing = transitionEvalLoop(diagnosed, {
			type: "diagnose",
			diagnosis: "Missed the rule",
			hypothesis: "Clarify the rule",
		});
		awaiting = transitionEvalLoop(editing, {
			type: "candidate-ready",
			revision: "candidate-0",
			contract,
		});
		running = transitionEvalLoop(awaiting, {
			type: "start-batch",
			batch: comparisonBatch,
		});
	});

	test("keep promotes evidence; revert retains it and history survives serialization", () => {
		const compared = compare(diagnosed, ["pass", "pass", "fail"]);
		const kept = decide(JSON.parse(JSON.stringify(compared)), "keep");
		expect(kept).toMatchObject({
			revision: "candidate-0",
			noGainCount: 0,
			baseline: { batchId: "comparison-0" },
			stage: { kind: "baseline-diagnosing" },
		});
		expect(kept.rounds[0]).toMatchObject({
			diagnosis: "Missed the rule",
			hypothesis: "Clarify the rule",
			decision: { action: "keep" },
		});
		const reverted = decide(compare(kept), "revert");
		expect(reverted.revision).toBe(kept.revision);
		expect(reverted.baseline).toEqual(kept.baseline);
		expect(reverted.rounds).toHaveLength(2);
		expect(reverted.rounds[0]).toEqual(kept.rounds[0]);
		expect(diagnosed.rounds).toEqual([]);
	});

	test("rejects skipped stages atomically", () => {
		rejectsAtomically(initial, {
			type: "diagnose",
			diagnosis: "x",
			hypothesis: "y",
		});
		rejectsAtomically(initial, {
			type: "candidate-ready",
			revision: "candidate",
			contract,
		});
		rejectsAtomically(editing, { type: "start-batch", batch: comparisonBatch });
	});
	test("refuses decisions before evidence in every predecision stage", () => {
		const event: LoopEvent = { type: "decide", action: "keep", reason: "x" };
		rejectsAtomically(initial, event);
		rejectsAtomically(diagnosed, event);
		rejectsAtomically(editing, event);
		rejectsAtomically(awaiting, event);
		rejectsAtomically(running, event);
	});
	test.each([
		{ suiteRevision: "new" },
		{ repetitions: 4 },
		{ target: { model: "other" } },
		{ scenario: "other" },
	])("rejects contract edits %j without rebaselining", (change) => {
		rejectsAtomically(editing, {
			type: "candidate-ready",
			revision: "candidate",
			contract: { ...contract, ...change },
		});
	});
	test.each([
		{ baselineBatchId: "wrong" },
		{ revision: "wrong" },
		{
			contract: {
				scenario: "other",
				suiteRevision: "suite-1",
				target: { model: "test" },
				repetitions: 3,
			},
		},
	])("rejects mismatched comparison %j", (change) => {
		rejectsAtomically(awaiting, {
			type: "start-batch",
			batch: { ...comparisonBatch, ...change },
		});
	});
	test.each([
		{ results: ["pass"] as LoopResult[] },
		{ baselineResults: undefined },
		{ baselineResults: [] },
		{
			batch: {
				id: "wrong",
				revision: "candidate-0",
				baselineBatchId: "baseline",
				contract: {
					scenario: "resources/focused",
					suiteRevision: "suite-1",
					target: { model: "test", agent: "test" },
					repetitions: 3,
				},
			},
		},
	])("requires complete matching paired evidence %j", (change) => {
		rejectsAtomically(running, {
			type: "finish-batch",
			completion: {
				batch: comparisonBatch,
				results: failing,
				baselineResults: failing,
				...change,
			},
		});
	});
	test.each([0, 1])(
		"completion %i retries are idempotent after terminal decision",
		(index) => {
			const completed = decide(compare(diagnosed, passing), "keep");
			const completion = completed.batches[index] as LoopCompletion;
			expect(
				transitionEvalLoop(completed, {
					type: "finish-batch",
					completion: structuredClone(completion),
				}),
			).toBe(completed);
			rejectsAtomically(completed, {
				type: "finish-batch",
				completion: { ...completion, results: ["fail", "fail", "fail"] },
			});
		},
	);
	test("three no-gain rounds stop and retained gain resets the count", () => {
		const stagnant = decide(compare(diagnosed), "keep");
		expect(stagnant.noGainCount).toBe(1);
		const improved = decide(
			compare(stagnant, ["pass", "pass", "fail"]),
			"keep",
		);
		expect(improved.noGainCount).toBe(0);
		const first = decide(compare(improved), "revert");
		const second = decide(compare(first), "revert");
		const third = decide(compare(second), "revert");
		expect(third).toMatchObject({
			noGainCount: 3,
			stage: { kind: "stopped", reason: "three-no-gain-rounds" },
		});
	});
	test("all passing completes a baseline or an accepted candidate", () => {
		expect(baseline(passing).stage.kind).toBe("complete");
		expect(baseline(["pass", "pass", "error"]).stage.kind).toBe(
			"baseline-diagnosing",
		);
		const compared = compare(diagnosed, passing);
		expect(compared.stage.kind).toBe("deciding");
		expect(decide(compared, "keep").stage).toEqual({
			kind: "complete",
			reason: "all-repetitions-passing",
		});
		expect(decide(compared, "revert").stage.kind).toBe("baseline-diagnosing");
	});
	test("rebaseline preserves history and requires fresh evidence", () => {
		const previous = decide(compare(diagnosed), "revert");
		const next = transitionEvalLoop(previous, {
			type: "rebaseline",
			contract: { ...contract, suiteRevision: "suite-2" },
		});
		expect(next.rounds).toEqual(previous.rounds);
		expect(next.batches).toEqual(previous.batches);
		expect(next.baseline).toBeUndefined();
		expect(next.noGainCount).toBe(0);
		rejectsAtomically(next, {
			type: "diagnose",
			diagnosis: "x",
			hypothesis: "y",
		});
		rejectsAtomically(next, {
			type: "start-batch",
			batch: { id: "new", contract, revision: "base" },
		});
		const batch = {
			id: "new",
			contract: next.contract,
			revision: next.revision,
		};
		const started = transitionEvalLoop(next, { type: "start-batch", batch });
		expect(
			transitionEvalLoop(started, {
				type: "finish-batch",
				completion: { batch, results: failing },
			}).stage.kind,
		).toBe("baseline-diagnosing");
		rejectsAtomically(started, { type: "rebaseline", contract });
	});
	test("manual stop retains the unfinished round and batch", () => {
		const stopped = transitionEvalLoop(running, {
			type: "stop",
			reason: "Budget exhausted",
		});
		expect(stopped.stage).toEqual({
			kind: "stopped",
			reason: "manual",
			detail: "Budget exhausted",
			interrupted: running.stage,
		});
		rejectsAtomically(stopped, { type: "rebaseline", contract });
	});
	test.each([0, -1, 1.5, Number.NaN])(
		"rejects invalid repetitions %s",
		(repetitions) => {
			expect(() =>
				createEvalLoop({ ...contract, repetitions }, "base"),
			).toThrow();
		},
	);
	test("isolates supplied evidence", () => {
		const results: LoopResult[] = [...failing];
		const loop = baseline(results);
		results[0] = "fail";
		expect(loop.baseline?.results).toEqual(failing);
	});
});

const contract: LoopContract = {
	scenario: "resources/focused",
	suiteRevision: "suite-1",
	target: { model: "test", agent: "test" },
	repetitions: 3,
};
const failing: LoopResult[] = ["pass", "fail", "error"];
const passing: LoopResult[] = ["pass", "pass", "pass"];
const comparisonBatch = {
	id: "comparison-0",
	contract,
	revision: "candidate-0",
	baselineBatchId: "baseline",
};
function baseline(results = failing): EvalLoop {
	const initial = createEvalLoop(contract, "base");
	const batch = { id: "baseline", contract, revision: "base" };
	return transitionEvalLoop(
		transitionEvalLoop(initial, { type: "start-batch", batch }),
		{ type: "finish-batch", completion: { batch, results } },
	);
}
function compare(
	loop: EvalLoop,
	results = failing,
	baselineResults = failing,
): EvalLoop {
	const revision = `candidate-${loop.rounds.length}`;
	let next = transitionEvalLoop(loop, {
		type: "diagnose",
		diagnosis: "Missed the rule",
		hypothesis: "Clarify the rule",
	});
	next = transitionEvalLoop(next, {
		type: "candidate-ready",
		revision,
		contract: next.contract,
	});
	const batch = {
		id: `comparison-${loop.rounds.length}`,
		contract: next.contract,
		revision,
		baselineBatchId: next.baseline?.batchId,
	};
	next = transitionEvalLoop(next, { type: "start-batch", batch });
	return transitionEvalLoop(next, {
		type: "finish-batch",
		completion: { batch, results, baselineResults },
	});
}
function decide(loop: EvalLoop, action: "keep" | "revert"): EvalLoop {
	return transitionEvalLoop(loop, {
		type: "decide",
		action,
		reason: "Reviewed evidence",
	});
}
function rejectsAtomically(loop: EvalLoop, event: LoopEvent): void {
	const before = structuredClone(loop);
	expect(() => transitionEvalLoop(loop, event)).toThrow();
	expect(loop).toEqual(before);
}

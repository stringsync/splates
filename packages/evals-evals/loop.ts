import type { ContractTarget } from "./contract";

export function createEvalLoop(
	contract: LoopContract,
	revision: string,
): EvalLoop {
	validateContract(contract);
	requireText(revision);
	return {
		contract: structuredClone(contract),
		revision,
		stage: { kind: "baseline-awaiting-run" },
		rounds: [],
		batches: [],
		noGainCount: 0,
	};
}

/** Pure transition: throws without modifying the input; exact completion retries are no-ops. */
export function transitionEvalLoop(loop: EvalLoop, event: LoopEvent): EvalLoop {
	if (event.type === "finish-batch") {
		const recorded = loop.batches.find(
			(item) => item.batch.id === event.completion.batch.id,
		);
		if (recorded) {
			requireCondition(
				sameBatch(recorded.batch, event.completion.batch) &&
					sameResults(recorded.results, event.completion.results) &&
					sameResults(
						recorded.baselineResults,
						event.completion.baselineResults,
					),
				"Batch ID already recorded with different evidence",
			);
			return loop;
		}
	}
	requireCondition(
		loop.stage.kind !== "complete" && loop.stage.kind !== "stopped",
		"Loop has ended",
	);
	// Own event payloads so later caller edits cannot rewrite experiment history.
	const input = structuredClone(event);
	const stage = loop.stage;
	switch (input.type) {
		case "stop":
			requireText(input.reason);
			return {
				...loop,
				stage: {
					kind: "stopped",
					reason: "manual",
					detail: input.reason,
					interrupted: stage,
				},
			};
		case "rebaseline":
			requireCondition(
				stage.kind === "baseline-awaiting-run" ||
					stage.kind === "baseline-diagnosing",
				"Rebaseline only between rounds and runs",
			);
			validateContract(input.contract);
			requireCondition(
				input.contract.scenario === loop.contract.scenario,
				"A loop tracks one scenario",
			);
			return {
				...loop,
				contract: input.contract,
				baseline: undefined,
				noGainCount: 0,
				stage: { kind: "baseline-awaiting-run" },
			};
		case "start-batch": {
			requireCondition(
				stage.kind === "baseline-awaiting-run" ||
					stage.kind === "awaiting-comparison",
				"Not awaiting a batch",
			);
			const batch = input.batch;
			requireText(batch.id);
			requireCondition(
				!loop.batches.some((item) => item.batch.id === batch.id),
				"Batch ID already used",
			);
			requireCondition(
				sameContract(batch.contract, loop.contract),
				"Test contract changed; rebaseline first",
			);
			if (stage.kind === "baseline-awaiting-run") {
				requireCondition(
					batch.revision === loop.revision &&
						batch.baselineBatchId === undefined,
					"Wrong baseline revision",
				);
				return { ...loop, stage: { kind: "baseline-running", batch } };
			}
			requireCondition(
				batch.revision === stage.round.candidateRevision &&
					batch.baselineBatchId === stage.round.baseline.batchId,
				"Comparison must use the selected candidate and baseline",
			);
			return {
				...loop,
				stage: { kind: "comparing", round: stage.round, batch },
			};
		}
		case "finish-batch": {
			requireCondition(
				stage.kind === "baseline-running" || stage.kind === "comparing",
				"No batch running",
			);
			const completion = input.completion;
			requireCondition(
				sameBatch(stage.batch, completion.batch),
				"Completion does not match the running batch",
			);
			validateResults(completion.results, loop.contract.repetitions);
			const batches = [...loop.batches, completion];
			if (stage.kind === "baseline-running") {
				requireCondition(
					completion.baselineResults === undefined,
					"Baseline run cannot contain comparison evidence",
				);
				const baseline = {
					batchId: completion.batch.id,
					revision: loop.revision,
					results: completion.results,
				};
				return {
					...loop,
					batches,
					baseline,
					stage:
						passes(completion.results) === loop.contract.repetitions
							? { kind: "complete", reason: "all-repetitions-passing" }
							: { kind: "baseline-diagnosing" },
				};
			}
			requireCondition(
				completion.baselineResults !== undefined,
				"Comparison requires baseline evidence",
			);
			validateResults(completion.baselineResults, loop.contract.repetitions);
			return {
				...loop,
				batches,
				stage: {
					kind: "deciding",
					round: { ...stage.round, comparison: completion },
				},
			};
		}
		case "diagnose":
			requireCondition(
				stage.kind === "baseline-diagnosing" && loop.baseline,
				"Baseline evidence required before diagnosis",
			);
			requireText(input.diagnosis);
			requireText(input.hypothesis);
			return {
				...loop,
				stage: {
					kind: "editing",
					round: {
						number: loop.rounds.length + 1,
						contract: loop.contract,
						baseline: loop.baseline,
						diagnosis: input.diagnosis,
						hypothesis: input.hypothesis,
					},
				},
			};
		case "candidate-ready":
			requireCondition(
				stage.kind === "editing",
				"Diagnose before editing a candidate",
			);
			requireText(input.revision);
			requireCondition(
				input.revision !== loop.revision,
				"Candidate must have a new revision",
			);
			requireCondition(
				sameContract(input.contract, loop.contract),
				"Test contract changed; rebaseline first",
			);
			return {
				...loop,
				stage: {
					kind: "awaiting-comparison",
					round: { ...stage.round, candidateRevision: input.revision },
				},
			};
		case "decide": {
			requireCondition(
				stage.kind === "deciding" && stage.round.comparison,
				"Comparison evidence required before deciding",
			);
			requireText(input.reason);
			const comparison = stage.round.comparison;
			const gain =
				passes(comparison.results) > passes(comparison.baselineResults ?? []);
			const keep = input.action === "keep";
			const noGainCount = keep && gain ? 0 : loop.noGainCount + 1;
			const baseline = keep
				? {
						batchId: comparison.batch.id,
						revision: comparison.batch.revision,
						results: comparison.results,
					}
				: loop.baseline;
			const nextStage: LoopStage =
				keep && passes(comparison.results) === loop.contract.repetitions
					? { kind: "complete", reason: "all-repetitions-passing" }
					: noGainCount >= 3
						? { kind: "stopped", reason: "three-no-gain-rounds" }
						: { kind: "baseline-diagnosing" };
			return {
				...loop,
				baseline,
				revision: baseline?.revision ?? loop.revision,
				noGainCount,
				rounds: [
					...loop.rounds,
					{
						...stage.round,
						decision: { action: input.action, reason: input.reason },
					},
				],
				stage: nextStage,
			};
		}
	}
}

/** Identifies the frozen test contract; revisions of the subject vary separately. */
export interface LoopContract {
	readonly scenario: string;
	readonly suiteRevision: string;
	readonly target: Readonly<ContractTarget>;
	readonly repetitions: number;
}

export type LoopResult = "pass" | "fail" | "error";
export interface LoopEvidence {
	readonly batchId: string;
	readonly revision: string;
	readonly results: readonly LoopResult[];
}
export interface LoopBatch {
	readonly id: string;
	readonly contract: LoopContract;
	readonly revision: string;
	/** Comparison batches must name the exact accepted baseline. */
	readonly baselineBatchId?: string;
}
export interface LoopCompletion {
	readonly batch: LoopBatch;
	readonly results: readonly LoopResult[];
	/** Fresh baseline repetitions, run alongside the candidate. */
	readonly baselineResults?: readonly LoopResult[];
}
export interface LoopRound {
	readonly number: number;
	readonly contract: LoopContract;
	readonly baseline: LoopEvidence;
	readonly diagnosis: string;
	readonly hypothesis: string;
	readonly candidateRevision?: string;
	readonly comparison?: LoopCompletion;
	readonly decision?: {
		readonly action: "keep" | "revert";
		readonly reason: string;
	};
}
export type LoopStage =
	| { readonly kind: "baseline-awaiting-run" }
	| { readonly kind: "baseline-running"; readonly batch: LoopBatch }
	| { readonly kind: "baseline-diagnosing" }
	| { readonly kind: "editing"; readonly round: LoopRound }
	| { readonly kind: "awaiting-comparison"; readonly round: LoopRound }
	| {
			readonly kind: "comparing";
			readonly round: LoopRound;
			readonly batch: LoopBatch;
	  }
	| { readonly kind: "deciding"; readonly round: LoopRound }
	| { readonly kind: "complete"; readonly reason: "all-repetitions-passing" }
	| {
			readonly kind: "stopped";
			readonly reason: "three-no-gain-rounds" | "manual";
			readonly detail?: string;
			/** Retains in-flight work when manually stopped. */
			readonly interrupted?: LoopStage;
	  };

/** JSON-serializable record. Persist the returned value atomically in the host. */
export interface EvalLoop {
	readonly contract: LoopContract;
	readonly revision: string;
	readonly baseline?: LoopEvidence;
	readonly stage: LoopStage;
	/** Completed rounds only. Rebaselining never discards these. */
	readonly rounds: readonly LoopRound[];
	readonly batches: readonly LoopCompletion[];
	readonly noGainCount: number;
}
export type LoopEvent =
	| { readonly type: "start-batch"; readonly batch: LoopBatch }
	| { readonly type: "finish-batch"; readonly completion: LoopCompletion }
	| {
			readonly type: "diagnose";
			readonly diagnosis: string;
			readonly hypothesis: string;
	  }
	| {
			readonly type: "candidate-ready";
			readonly revision: string;
			readonly contract: LoopContract;
	  }
	| {
			readonly type: "decide";
			readonly action: "keep" | "revert";
			readonly reason: string;
	  }
	| { readonly type: "rebaseline"; readonly contract: LoopContract }
	| { readonly type: "stop"; readonly reason: string };

function requireCondition(
	condition: unknown,
	message: string,
): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}
function requireText(value: string): void {
	requireCondition(value.trim().length > 0, "Expected nonempty text");
}
function validateContract(contract: LoopContract): void {
	requireText(contract.scenario);
	requireText(contract.suiteRevision);
	requireText(contract.target.model);
	requireCondition(
		Number.isSafeInteger(contract.repetitions) && contract.repetitions > 0,
		"Repetitions must be a positive integer",
	);
}
function sameContract(left: LoopContract, right: LoopContract): boolean {
	return (
		left.scenario === right.scenario &&
		left.suiteRevision === right.suiteRevision &&
		left.repetitions === right.repetitions &&
		left.target.model === right.target.model &&
		left.target.agent === right.target.agent &&
		left.target.effort === right.target.effort &&
		left.target.variant === right.target.variant
	);
}
function sameBatch(left: LoopBatch, right: LoopBatch): boolean {
	return (
		left.id === right.id &&
		left.revision === right.revision &&
		left.baselineBatchId === right.baselineBatchId &&
		sameContract(left.contract, right.contract)
	);
}
function sameResults(
	left: readonly LoopResult[] | undefined,
	right: readonly LoopResult[] | undefined,
): boolean {
	return left === undefined
		? right === undefined
		: right !== undefined &&
				left.length === right.length &&
				left.every((value, index) => value === right[index]);
}
function validateResults(
	results: readonly LoopResult[],
	repetitions: number,
): void {
	requireCondition(
		results.length === repetitions &&
			Array.from(results).every((result) =>
				["pass", "fail", "error"].includes(result),
			),
		"Evidence must contain every repetition exactly once",
	);
}
function passes(results: readonly LoopResult[]): number {
	return results.filter((result) => result === "pass").length;
}

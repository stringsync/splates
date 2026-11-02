import type { EvalLaunchSpec } from "./launch";
import type { EvalLoopStore } from "./loops";
import type { EvalGrid } from "./types";

/** Validate conversation run requests and save their finished evidence. */
export class LoopRuns {
	constructor(private readonly store: EvalLoopStore) {}
	async check(spec: EvalLaunchSpec): Promise<void> {
		const store = this.store;
		if (spec.loop === undefined) {
			return;
		}
		const saved = await store.show(spec.loop.id);
		const { contract, stage } = saved.loop;
		if (
			saved.version !== spec.loop.version ||
			!["baseline-awaiting-run", "awaiting-comparison"].includes(stage.kind)
		) {
			throw new Error("Loop changed; ask the agent for a current run card");
		}
		const target = spec.agents[0];
		if (
			spec.conversation !== saved.conversation ||
			spec.scenarios.length !== 1 ||
			spec.scenarios[0] !== contract.scenario ||
			spec.reps !== contract.repetitions ||
			spec.agents.length !== 1 ||
			target?.agent !== contract.target.agent ||
			target?.model !== contract.target.model ||
			target?.effort !== contract.target.effort ||
			contract.target.variant !== undefined ||
			spec.baseline !==
				(stage.kind === "awaiting-comparison"
					? stage.round.baseline.revision
					: null)
		) {
			throw new Error(
				"Run differs from the frozen loop contract; reconfigure and rebaseline first",
			);
		}
	}

	/** Record the finished batch for the loop version named by its run card. */
	async record(
		reference: { id: string; version: number },
		grid: EvalGrid,
	): Promise<void> {
		const store = this.store;
		const saved = await store.at(reference.id, reference.version);
		const { loop } = saved;
		const stage = loop.stage;
		if (
			stage.kind !== "baseline-awaiting-run" &&
			stage.kind !== "awaiting-comparison"
		) {
			throw new Error("Run card did not name an awaiting loop");
		}
		const comparison = stage.kind === "awaiting-comparison";
		const batch = {
			id: grid.id,
			contract: loop.contract,
			revision: comparison
				? (stage.round.candidateRevision as string)
				: loop.revision,
			...(comparison ? { baselineBatchId: stage.round.baseline.batchId } : {}),
		};
		const results = (baseline: boolean): ("pass" | "fail" | "error")[] => {
			const target = grid.targets.filter(
				(each) =>
					each.agent === loop.contract.target.agent &&
					each.model === loop.contract.target.model &&
					(each.effort ?? undefined) === loop.contract.target.effort &&
					(baseline
						? each.skill === (comparison ? stage.round.baseline.revision : null)
						: each.skill === null),
			);
			if (target.length !== 1) {
				throw new Error("Completion target does not match the loop");
			}
			return Array.from(
				{ length: loop.contract.repetitions },
				(_, repetition) => {
					const cells = grid.grid.filter(
						(cell) =>
							cell.scenario === loop.contract.scenario &&
							cell.target === target[0]?.key &&
							cell.repetition === repetition,
					);
					const status = cells[0]?.run?.status;
					if (
						cells.length !== 1 ||
						(status !== "pass" && status !== "fail" && status !== "error")
					) {
						throw new Error("Completion is missing unique repetition evidence");
					}
					return status;
				},
			);
		};
		const completion = {
			batch,
			results: results(false),
			...(comparison ? { baselineResults: results(true) } : {}),
		};
		await store.change(reference.id, {
			id: `run-${grid.id}`,
			expectedVersion: reference.version,
			event: { type: "start-batch", batch },
		});
		await store.change(reference.id, {
			id: `done-${grid.id}`,
			expectedVersion: reference.version + 1,
			event: { type: "finish-batch", completion },
		});
	}
}

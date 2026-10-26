import type { Event } from "../records";
import { MERGE_STEPS, type MergeStep } from "../tasks";

/** How many of the project's last landed merges the typical times come from. */
export const ESTIMATED_FROM = 20;

/** How long each step and premerge phase of a merge usually takes here. */
export interface MergeEstimates {
	/** The median milliseconds of each step; a step no recent merge timed is left out. */
	steps: Partial<Record<MergeStep, number>>;
	/**
	 * The median milliseconds of each phase the premerge times, in the order
	 * the last gate ran them, each with the phase it runs inside of, if any.
	 */
	phases: { phase: string; ms: number; within?: string }[];
	/** How many landed merges they come from. */
	merges: number;
}

type Merged = Extract<Event, { action: "merge" }>;

/**
 * The typical times of the last `ESTIMATED_FROM` merges that landed among
 * `events`, oldest first. The wait for the premerge lock is what each gated
 * merge kept of it, and a merge from before steps were timed still gives its
 * gate's time. `setup`, the time a
 * gate's phases leave, is no phase the page sees start, so it is left out.
 */
export function mergeEstimates(events: readonly Event[]): MergeEstimates {
	const merges = events
		.filter(
			(event): event is Merged & { reason: null } =>
				event.action === "merge" && event.reason === null,
		)
		.slice(-ESTIMATED_FROM);
	const steps: MergeEstimates["steps"] = {};
	for (const step of MERGE_STEPS) {
		const ms = median(merges.flatMap((merge) => stepMs(merge, step)));
		if (ms !== null) {
			steps[step] = ms;
		}
	}
	const last = merges.findLast((merge) => merge.gate !== undefined)?.gate;
	const phases: MergeEstimates["phases"] = Object.keys(last?.ms ?? {})
		.filter((phase) => phase !== "setup")
		.flatMap((phase) => {
			const ms = median(
				merges.flatMap((merge) => {
					const took = merge.gate?.ms[phase];
					return took === undefined ? [] : [took];
				}),
			);
			const within = last?.within?.[phase];
			return ms === null
				? []
				: [{ phase, ms, ...(within === undefined ? {} : { within }) }];
		});
	return { steps, phases, merges: merges.length };
}

function stepMs(merge: Merged, step: MergeStep): number[] {
	// A merge that found the lock free never entered its wait, so the wait
	// it timed counts, as none.
	if (step === "wait") {
		return merge.gate !== undefined && merge.capacityWaitMs !== undefined
			? [merge.capacityWaitMs]
			: [];
	}
	const timed = merge.stepsMs?.[step];
	if (timed !== undefined) {
		return [timed];
	}
	if (merge.stepsMs !== undefined || merge.gate === undefined) {
		return [];
	}
	// Before steps were timed: only what a gated merge kept of its gate.
	if (step === "test" && merge.gateMs !== undefined) {
		return [merge.gateMs];
	}
	return [];
}

function median(values: number[]): number | null {
	if (values.length === 0) {
		return null;
	}
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return Math.round(
		sorted.length % 2 === 1
			? (sorted[middle] ?? 0)
			: ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2,
	);
}

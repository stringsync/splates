import type { MergeEstimates } from "@stringsync/splates-server/merge";
import type {
	Details,
	LivePhase,
	MergeStep,
} from "@stringsync/splates-server/tasks";
import { MERGE_STEPS } from "@stringsync/splates-server/tasks/browser";
import { placeInLine } from "./merge-place";

/** Where a step or phase of a merge stands: over, under way, or to come. */
export type Standing = "done" | "running" | "next";

/** A phase of the premerge, with those it runs beside its siblings inside. */
export interface PhaseRow {
	phase: string;
	standing: Standing;
	/** How long it took, or has run so far; null when the gate never said, or for one to come. */
	ms: number | null;
	/** How long it took in recent merges, for one under way or to come; null otherwise or unknown. */
	typical: number | null;
	inside: PhaseRow[];
}

/** A step of a merge as its checklist shows it. */
export interface StepRow {
	step: MergeStep;
	label: string;
	standing: Standing;
	/** How long it took, or has run so far; null for one to come. */
	ms: number | null;
	/** How long it took in recent merges, for one under way or to come; null otherwise or unknown. */
	typical: number | null;
	/** The premerge's phases, on its last run. */
	phases: PhaseRow[];
}

/**
 * The checklist of `task`'s merge under way at `now`: each step it has taken,
 * timed, the last under way, then those it has yet to take; empty with no
 * merge under way. A merge with no premerge to run neither waits nor tests,
 * and one past its premerge waits no more. With `estimates`, the steps and
 * phases under way or to come say how long they took in recent merges, and
 * a premerge under way lists the phases it has yet to start.
 */
export function mergeChecklist(
	task: Details,
	now: number,
	estimates: MergeEstimates | null = null,
): StepRow[] {
	const progress = task.mergeSteps;
	if (progress === null || progress.steps.length === 0) {
		return [];
	}
	const { steps } = progress;
	const lastTest = steps.findLastIndex((each) => each.step === "test");
	const taken: StepRow[] = steps.map((each, index) => {
		const ends = steps[index + 1]?.at;
		const running = ends === undefined;
		return {
			step: each.step,
			label: labelOf(task, each.step, running),
			standing: running ? "running" : "done",
			ms: Math.max(0, (ends ? Date.parse(ends) : now) - Date.parse(each.at)),
			typical: running ? (estimates?.steps[each.step] ?? null) : null,
			phases:
				index === lastTest
					? phaseRows(progress.phases ?? [], running, now, estimates)
					: [],
		};
	});
	const gated = task.gate !== null;
	const tested = lastTest >= 0;
	const last = steps.at(-1)?.step ?? "rebase";
	// Checks before the line run only where the project has them, which
	// the page learns once they start.
	const toCome = MERGE_STEPS.slice(MERGE_STEPS.indexOf(last) + 1).filter(
		(step) =>
			step !== "check" &&
			(step !== "wait" || (gated && !tested)) &&
			(step !== "test" || gated),
	);
	return [
		...taken,
		...toCome.map(
			(step): StepRow => ({
				step,
				label: labelOf(task, step, false),
				standing: "next",
				ms: null,
				typical: estimates?.steps[step] ?? null,
				phases: [],
			}),
		),
	];
}

function labelOf(task: Details, step: MergeStep, running: boolean): string {
	switch (step) {
		case "rebase":
			return `Rebase onto ${task.base}`;
		case "check":
			return "Checks before the line";
		case "wait":
			return running && task.mergePlace !== null
				? `Wait for its turn, ${placeInLine(task.mergePlace)}`
				: "Wait for its turn";
		case "test":
			return "Premerge";
		case "land":
			return `Land on ${task.base}`;
		case "finish":
			return "Clean up";
	}
}

/**
 * The phases as rows, those run inside another under it. A phase with no
 * end is under way while the premerge is; once it is over, it ended
 * without saying so. While it runs, the phases recent merges ran that it has
 * yet to start follow, each where it ran.
 */
function phaseRows(
	phases: LivePhase[],
	testing: boolean,
	now: number,
	estimates: MergeEstimates | null,
): PhaseRow[] {
	const typicalOf = (phase: string): number | null =>
		estimates?.phases.find((each) => each.phase === phase)?.ms ?? null;
	const row = (phase: LivePhase): PhaseRow => {
		const running = phase.ms === undefined && testing;
		return {
			phase: phase.phase,
			standing: running ? "running" : "done",
			ms:
				phase.ms ??
				(phase.at !== undefined && testing
					? Math.max(0, now - Date.parse(phase.at))
					: null),
			typical: running ? typicalOf(phase.phase) : null,
			inside: [],
		};
	};
	const toCome = testing
		? (estimates?.phases ?? [])
				.filter((each) => !phases.some((phase) => phase.phase === each.phase))
				.map(
					(each): LivePhase => ({
						phase: each.phase,
						...(each.within === undefined ? {} : { within: each.within }),
					}),
				)
		: [];
	const all = [...phases, ...toCome];
	const rowOf = (phase: LivePhase): PhaseRow =>
		toCome.includes(phase)
			? {
					phase: phase.phase,
					standing: "next",
					ms: null,
					typical: typicalOf(phase.phase),
					inside: [],
				}
			: row(phase);
	const tops = all.filter(
		(phase) =>
			phase.within === undefined ||
			!all.some((other) => other.phase === phase.within),
	);
	return tops.map((top) => ({
		...rowOf(top),
		inside: all
			.filter((phase) => phase.within === top.phase)
			.map((phase) => rowOf(phase)),
	}));
}

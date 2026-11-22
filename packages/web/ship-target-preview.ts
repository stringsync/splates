import type { StepState } from "@splates/server/ship";

/** Keep ongoing work on the rail, with one next step for context. */
export function targetPreview(steps: StepState[]) {
	const unfinished = steps.filter((step) => !completed(step));
	const active = unfinished.filter((step) =>
		["running", "checking", "waiting", "failed"].includes(step.status),
	);
	const current = active.length > 0 ? active : unfinished.slice(0, 1);
	const next = unfinished.find((step) => !current.includes(step));
	const shown = next === undefined ? current : [...current, next];
	return {
		steps: steps.filter((step) => shown.includes(step)),
		completed: steps.length - unfinished.length,
		later: unfinished.length - shown.length,
	};
}

function completed(step: StepState): boolean {
	return step.status === "done" || step.status === "skipped";
}

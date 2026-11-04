import type { CascadeStep, Stage, StageKey } from "@splates/server/ship";

/** The steps that wait on the person, which never count as slow. */
export const PERSON_STAGES: StageKey[] = ["login", "otp", "approve"];

/** How long `stage` has gone, or took, in ms; null before it starts. */
export function spentOn(stage: Stage, now: number): number | null {
	if (stage.started === null) {
		return null;
	}
	const end = stage.ended === null ? now : Date.parse(stage.ended);
	return end - Date.parse(stage.started);
}

/** Whether `stage` has gone past the time it is expected to take, ignoring the ones waiting on the person. */
export function isSlow(stage: Stage, now: number): boolean {
	const spent = spentOn(stage, now);
	return (
		spent !== null &&
		stage.expected > 0 &&
		spent > stage.expected &&
		stage.state !== "skipped" &&
		stage.state !== "asking" &&
		!PERSON_STAGES.includes(stage.key)
	);
}

/** The step of `step` that is furthest past its expected time, or null when none is. */
export function slowestOf(step: CascadeStep, now: number): Stage | null {
	let slowest: Stage | null = null;
	let over = 0;
	for (const stage of step.stages) {
		const spent = spentOn(stage, now);
		if (spent !== null && isSlow(stage, now) && spent - stage.expected > over) {
			slowest = stage;
			over = spent - stage.expected;
		}
	}
	return slowest;
}

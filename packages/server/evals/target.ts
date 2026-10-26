import type { EvalTarget } from "./types";

/** `claude sonnet high`, then `@<revision>` for a baseline skill, as the page names a target. */
export function targetName(target: EvalTarget): string {
	return [
		target.agent,
		target.model,
		target.effort,
		target.skill === null ? null : `@${target.skill}`,
	]
		.filter((part) => part !== null)
		.join(" ");
}

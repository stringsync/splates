import type { AgentPick } from "../models";
import type { EvalTarget } from "./types";

/** The name the page shows for a target: its agent, model and effort, then `@<revision>` for a baseline skill. */
export function targetName(target: EvalTarget): string {
	return [
		target.agent,
		target.model,
		target.effort,
		target.skill === null ? null : `@${target.skill}`,
	]
		.filter((part) => part !== null && part !== "")
		.join(" ");
}

/**
 * The `claude:MODEL@EFFORT` name of a saved agent, as `--agent` takes it and as
 * a run card's `Agents:` line names it; model and effort are left out when unset.
 */
export function targetOf(pick: AgentPick): string {
	return `${pick.agent}${pick.model === undefined ? "" : `:${pick.model}`}${
		pick.effort === undefined ? "" : `@${pick.effort}`
	}`;
}

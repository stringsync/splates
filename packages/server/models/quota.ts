import { CAP_PREFIX } from "../agents";
import type { Limit } from "../conversations";
import { isAntigravity } from "./antigravity-limits";
import { antigravityLimitsForModel } from "./antigravity-quota";
import type { RosterAgent } from "./roster";

/**
 * The plan windows of `limits` (one agent's, `Limits.all()[agent.id]`) that
 * bound `model`: Antigravity's group for it, or every window but the caps of
 * other models.
 */
export function limitsForModel(
	agent: RosterAgent,
	limits: readonly Limit[],
	model: string | undefined,
): Limit[] {
	return isAntigravity(agent)
		? antigravityLimitsForModel(limits, model)
		: limits.filter(
				(each) =>
					!each.window.startsWith(CAP_PREFIX) ||
					each.window === `${CAP_PREFIX}${model ?? ""}`,
			);
}

/** The most used of `limits` that have not reset by `now`; undefined when none. */
export function mostUsed(
	limits: readonly Limit[],
	now: Date,
): Limit | undefined {
	return limits
		.filter(
			(each) =>
				each.resets === null || !(Date.parse(each.resets) <= now.getTime()),
		)
		.reduce<Limit | undefined>(
			(most, each) =>
				most === undefined || each.used > most.used ? each : most,
			undefined,
		);
}

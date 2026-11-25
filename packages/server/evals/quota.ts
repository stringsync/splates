import type { Limit } from "../conversations";
import {
	type AgentPick,
	antigravityLimitsForModel,
	isAntigravity,
	type RosterAgent,
} from "../models";
import { overarching } from "../signals/quota";
import { targetOf } from "./target";

/** Windows Claude reports that its usage settings leave out, as the Usage page does. */
const UNSHOWN = new Set(["seven_day_overage_included"]);

/** One quota window a saved eval agent draws from. */
export interface EvalQuotaWindow {
	window: string;
	/** The share left, from 0 to 1; 1 once the window has reset since the reading. */
	left: number;
	resets: string | null;
}

/** How much quota a saved eval agent has left. */
export interface EvalQuota {
	/** As `splates evals agents` prints it. */
	target: string;
	windows: EvalQuotaWindow[];
	/** The share left in its longest window, what the ladder ranks scouts by; null when it never said. */
	headroom: number | null;
}

/**
 * The quota `pick` has left, from its agent's recorded `limits`: only the
 * windows its model draws from, as auto-pick and the Usage page choose them.
 */
export function evalQuota(
	pick: AgentPick,
	agent: RosterAgent | undefined,
	limits: readonly Limit[],
	now: number,
): EvalQuota {
	const applying = windowsFor(pick, agent, limits);
	const leftOf = (each: Limit): number =>
		each.resets !== null && Date.parse(each.resets) <= now
			? 1
			: Math.max(0, Math.min(1, 1 - each.used));
	const longest = overarching(applying);
	return {
		target: targetOf(pick),
		windows: applying.map((each) => ({
			window: each.window,
			left: leftOf(each),
			resets: each.resets,
		})),
		headroom: longest.length === 0 ? null : Math.min(...longest.map(leftOf)),
	};
}

function windowsFor(
	pick: AgentPick,
	agent: RosterAgent | undefined,
	limits: readonly Limit[],
): Limit[] {
	if (agent !== undefined && isAntigravity(agent)) {
		return antigravityLimitsForModel(limits, pick.model);
	}
	const model = (pick.model ?? "").toLowerCase();
	return limits.filter((each) => {
		if (UNSHOWN.has(each.window)) {
			return false;
		}
		if (each.window.startsWith("cap:")) {
			return each.window === `cap:${pick.model ?? ""}`;
		}
		// Claude's per-model weekly windows (`seven_day_opus`) apply to that model only.
		const family = /^seven_day_(.+)$/.exec(each.window)?.[1];
		return family === undefined || model.includes(family);
	});
}

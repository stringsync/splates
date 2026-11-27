import { CAP_PREFIX } from "../agents";
import type { Limit } from "../conversations";
import { type AgentPick, antigravityLimitsForModel } from "../models";
import { type AutopickRules, planOf } from "./rules";

/** Why an agent-queued task is held: each quota plan it could go to is inside the reserve. */
export interface ReserveHold {
	/** The reserve, 0 to 1, of each plan window that must be left. */
	reserve: number;
	/** Each quota plan it could route to, with its tightest window. */
	agents: {
		agent: string;
		window: string;
		left: number;
		resets: string | null;
	}[];
	/** The soonest any of those windows starts over; null when none says. */
	frees: string | null;
}

/**
 * Whether a task's every possible quota plan has less than `reserve` left in
 * some plan window: the pick it names, else any plan a lineup of `rules` holds.
 * A plan that reports no window counts as having room; a window past its reset
 * counts as full again.
 */
export function reserveHold({
	reserve,
	named,
	rules,
	runnable,
	limits,
	now,
}: {
	reserve: number;
	named: AgentPick | undefined;
	rules: AutopickRules;
	runnable: readonly string[];
	limits: Record<string, Limit[]>;
	now: Date;
}): ReserveHold | null {
	if (reserve <= 0) {
		return null;
	}
	const picks = candidatePicks(named, rules, runnable);
	if (picks.length === 0) {
		return null;
	}
	const agents: ReserveHold["agents"] = [];
	for (const pick of picks) {
		const relevant = relevantLimits(pick, limits[pick.agent] ?? []);
		const tight = relevant
			.filter(
				(window) => window.resets === null || new Date(window.resets) > now,
			)
			.map((window) => ({
				agent: pick.agent,
				window: window.window,
				left: 1 - window.used,
				resets: window.resets,
			}))
			.filter((window) => window.left < reserve)
			.sort((low, high) => low.left - high.left)[0];
		if (tight === undefined) {
			return null;
		}
		agents.push(tight);
	}
	const times = agents
		.map((each) => each.resets)
		.filter((at): at is string => at !== null)
		.sort();
	return { reserve, agents, frees: times[0] ?? null };
}

function candidatePicks(
	named: AgentPick | undefined,
	rules: AutopickRules,
	runnable: readonly string[],
): AgentPick[] {
	if (named !== undefined) {
		return [named];
	}
	const seen = new Set<string>();
	const picks: AgentPick[] = [];
	for (const lineup of rules.lineups) {
		for (const pick of lineup.picks) {
			if (!runnable.includes(pick.agent)) {
				continue;
			}
			const plan = planOf(pick);
			if (seen.has(plan)) {
				continue;
			}
			seen.add(plan);
			picks.push(pick);
		}
	}
	return picks;
}

function relevantLimits(pick: AgentPick, all: readonly Limit[]): Limit[] {
	if (pick.agent === "antigravity") {
		return antigravityLimitsForModel(all, pick.model ?? "gemini");
	}
	return all.filter(
		(each) =>
			!each.window.startsWith(CAP_PREFIX) ||
			each.window === `${CAP_PREFIX}${pick.model ?? ""}`,
	);
}

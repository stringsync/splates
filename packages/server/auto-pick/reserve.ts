import type { Limit } from "../conversations";
import type { AgentPick } from "../models";
import type { AutoPickRules } from "./rules";

/** Why an agent-queued task is held: each agent it could go to is inside the reserve. */
export interface ReserveHold {
	/** The reserve, 0 to 1, of each plan window that must be left. */
	reserve: number;
	/** Each agent it could route to, with its tightest window. */
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
 * Whether a task's every possible agent has less than `reserve` left in some
 * plan window: the one it names, else any a lineup of `rules` holds. An agent
 * that reports no window counts as having room; a window past its reset
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
	rules: AutoPickRules;
	runnable: readonly string[];
	limits: Record<string, Limit[]>;
	now: Date;
}): ReserveHold | null {
	if (reserve <= 0) {
		return null;
	}
	const ids =
		named !== undefined
			? [named.agent]
			: [
					...new Set(
						rules.lineups.flatMap((lineup) =>
							lineup.picks.map((pick) => pick.agent),
						),
					),
				].filter((id) => runnable.includes(id));
	if (ids.length === 0) {
		return null;
	}
	const agents: ReserveHold["agents"] = [];
	for (const agent of ids) {
		const tight = (limits[agent] ?? [])
			.filter(
				(window) => window.resets === null || new Date(window.resets) > now,
			)
			.map((window) => ({
				agent,
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

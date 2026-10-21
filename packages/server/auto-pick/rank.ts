import type { AutoPickSet } from "../conversations";
import { type AgentPick, type RosterAgent, traitsOf } from "../models";

/**
 * Whether `to` is above `from` on the same agent: a model of a higher tier,
 * or the same model at a higher thinking level, as the roster ranks them. A
 * model it cannot rank moves nothing.
 */
export function higher(
	agents: RosterAgent[],
	from: AutoPickSet,
	to: AgentPick,
): boolean {
	if (to.agent !== from.agent) {
		return false;
	}
	if ((to.model ?? null) !== from.model) {
		const was = traitsOf(agents, pickOf(from))?.tier;
		const now = traitsOf(agents, to)?.tier;
		return was !== undefined && now !== undefined && now > was;
	}
	return rank(from.effort) < rank(to.effort ?? null);
}

/** Thinking levels from least to most; one not among them ranks lowest. */
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"];

function rank(effort: string | null): number {
	return effort === null ? -1 : EFFORTS.indexOf(effort.toLowerCase());
}

/** What `set` picked, as the roster names a pick. */
export function pickOf(set: AutoPickSet): AgentPick {
	return {
		agent: set.agent,
		...(set.model === null ? {} : { model: set.model }),
		...(set.effort === null ? {} : { effort: set.effort }),
	};
}

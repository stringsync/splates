import { color } from "core/log";
import type { Limit } from "../conversations";
import { limitsForModel, mostUsed, type RosterAgent } from "../models";
import { table } from "../table";

/** How much of one agent's and model's plan is left, as `splates agents --quota --json` prints it. */
export interface QuotaLeft {
	agent: string;
	/** The model's id; null for an agent that lists none. */
	model: string | null;
	/** The share of the plan left, 0 to 1, from its most used window; null when unknown. */
	left: number | null;
	/** The window that leaves the least, as the agent names it (`five_hour`). */
	window: string | null;
	/** When that window starts over, as an ISO timestamp. */
	resets: string | null;
	/** When the agent last said how much of it was used. */
	at: string | null;
}

/**
 * Each agent's and model's plan quota left, from the windows it last
 * reported (`Limits.all()`): the most used window that applies to the model
 * and has not reset by `now`, or unknown when there is none.
 */
export function quotaLeft(
	agents: readonly RosterAgent[],
	limits: Record<string, Limit[]>,
	now: Date,
): QuotaLeft[] {
	return agents.flatMap((agent) => {
		const models =
			agent.models.length === 0 ? [null] : agent.models.map((each) => each.id);
		return models.map((model) => {
			const most = mostUsed(
				limitsForModel(agent, limits[agent.id] ?? [], model ?? undefined),
				now,
			);
			return {
				agent: agent.id,
				model,
				left:
					most === undefined ? null : Math.min(1, Math.max(0, 1 - most.used)),
				window: most?.window ?? null,
				resets: most?.resets ?? null,
				at: most?.at ?? null,
			};
		});
	});
}

/** `rows` as a table, with unknown where no window applies. */
export function quotaTable(rows: readonly QuotaLeft[]): string {
	if (rows.length === 0) {
		return "no agents";
	}
	return table(
		["AGENT", "MODEL", "LEFT", "WINDOW", "RESETS", "READ"],
		rows.map((row) => [
			row.agent,
			row.model ?? "",
			row.left === null
				? color.dim("unknown")
				: `${Math.round(row.left * 100)}%`,
			row.window ?? "",
			row.resets ?? "",
			row.at ?? "",
		]),
	);
}

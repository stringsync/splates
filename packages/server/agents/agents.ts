import { color, type Logger } from "core/log";
import { SystemWallClock, type WallClock } from "core/time";
import type { Limit, Setting } from "../conversations";
import { effortsOf, type Roster, traitsOf } from "../models";
import { table } from "../table";
import { quotaLeft, quotaTable } from "./quota";

export interface AgentsOptions {
	/** Print the roster as JSON instead of tables. */
	json?: boolean;
	/** Print each agent's and model's plan quota left instead of the roster. */
	quota?: boolean;
}

/**
 * The roster: each agent, how it starts, its models with what each is good
 * at and costs, and the thinking levels it offered when last started, for an
 * orchestrator choosing whom to delegate to. Writes the defaults first when
 * there is none, and says where, so they can be edited.
 */
export async function agents(
	{
		roster,
		offered,
		log,
		limits,
		clock,
	}: {
		roster: Roster;
		/** Each agent's plan limits as last reported, by its id (`Limits.all()`); needed for `quota`. */
		limits?: () => Promise<Record<string, Limit[]>>;
		/** Tells which windows have reset; the system's by default. */
		clock?: WallClock;
		/** What each agent's sessions last offered, by its id. */
		offered: Record<string, Setting[]>;
		log: Logger;
	},
	{ json = false, quota = false }: AgentsOptions = {},
): Promise<void> {
	const seeded = await roster.seed();
	const found = await roster.agents();
	if (quota) {
		const rows = quotaLeft(
			found,
			(await limits?.()) ?? {},
			new Date((clock ?? new SystemWallClock()).now()),
		);
		log.info(json ? JSON.stringify(rows, null, "\t") : quotaTable(rows));
		return;
	}
	const efforts = (agent: string) => effortsOf(offered[agent] ?? []);
	if (json) {
		log.info(
			JSON.stringify(
				found.map((agent) => ({
					...agent,
					efforts: efforts(agent.id),
					models: agent.models.map((model) => ({
						...model,
						...traitsOf(found, { agent: agent.id, model: model.id }),
					})),
				})),
				null,
				"\t",
			),
		);
		return;
	}
	if (seeded) {
		log.info(`${color.green("wrote")} the default roster to ${roster.path}`);
	}
	if (found.length === 0) {
		log.info(`no agents: add them to ${roster.path}`);
		return;
	}
	log.info(
		found
			.map((agent) =>
				[
					`${color.bold(agent.name)} ${color.dim(`(${agent.id})`)}  ${agent.argv.join(" ")}`,
					agent.models.length === 0
						? color.dim("  no models listed")
						: table(
								["MODEL", "NAME", "SPEED", "COST", "GOOD AT"],
								agent.models.map((model) => [
									model.id,
									model.name,
									traitsOf(found, { agent: agent.id, model: model.id })
										?.speed ?? "",
									model.cost,
									model.strengths,
								]),
							)
								.split("\n")
								.map((line) => `  ${line}`)
								.join("\n"),
					...(efforts(agent.id).length === 0
						? []
						: [`  ${color.dim("THINKING")}  ${efforts(agent.id).join(", ")}`]),
				].join("\n"),
			)
			.join("\n\n"),
	);
	log.info(color.dim(`\nedit ${roster.path} to change it`));
}

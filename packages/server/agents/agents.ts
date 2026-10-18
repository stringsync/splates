import { color, type Logger } from "webappwiz/log";
import type { Setting } from "../conversations";
import { effortsOf, type Roster, traitsOf } from "../models";
import { table } from "../table";

export interface AgentsOptions {
	/** Print the roster as JSON instead of tables. */
	json?: boolean;
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
	}: {
		roster: Roster;
		/** What each agent's sessions last offered, by its id. */
		offered: Record<string, Setting[]>;
		log: Logger;
	},
	{ json = false }: AgentsOptions = {},
): Promise<void> {
	const seeded = await roster.seed();
	const found = await roster.agents();
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

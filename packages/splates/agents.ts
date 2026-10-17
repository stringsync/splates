import { color, type Logger } from "webappwiz/log";
import type { Roster } from "./roster";
import { table } from "./table";

export interface AgentsOptions {
	/** Print the roster as JSON instead of tables. */
	json?: boolean;
}

/**
 * The roster: each agent, how it starts, and its models with what each is
 * good at and costs, for an orchestrator choosing whom to delegate to. Writes
 * the defaults first when there is none, and says where, so they can be edited.
 */
export async function agents(
	{ roster, log }: { roster: Roster; log: Logger },
	{ json = false }: AgentsOptions = {},
): Promise<void> {
	const seeded = await roster.seed();
	const found = await roster.agents();
	if (json) {
		log.info(JSON.stringify(found, null, "\t"));
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
								["MODEL", "NAME", "COST", "GOOD AT"],
								agent.models.map((model) => [
									model.id,
									model.name,
									model.cost,
									model.strengths,
								]),
							)
								.split("\n")
								.map((line) => `  ${line}`)
								.join("\n"),
				].join("\n"),
			)
			.join("\n\n"),
	);
	log.info(color.dim(`\nedit ${roster.path} to change it`));
}

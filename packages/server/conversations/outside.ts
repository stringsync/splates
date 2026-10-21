import type { Lock } from "webappwiz/system";
import type { Timer } from "webappwiz/time";
import {
	type Agent,
	type Launcher,
	listSessions,
	type Session,
} from "../agents";
import type { Conversation } from "./conversation";

/**
 * The sessions `agents` hold in `cwd` outside splates, the latest first:
 * those none of `known` has brought in. An agent that cannot list its
 * sessions lists none.
 */
export async function outside(
	known: readonly Conversation[],
	agents: readonly Agent[],
	cwd: string,
	{
		launch,
		timer,
		starting,
	}: {
		launch: Launcher["launch"];
		timer: Timer;
		starting: Lock;
	},
): Promise<Session[]> {
	const held = new Set(
		known.map((each) => `${each.state.agent} ${each.sessionId}`),
	);
	const listed = await Promise.all(
		agents.map((agent) =>
			listSessions(agent, cwd, launch, timer, starting).catch(
				(): Session[] => [],
			),
		),
	);
	return listed
		.flat()
		.filter((each) => !held.has(`${each.agent} ${each.session}`))
		.sort((one, other) =>
			(other.updatedAt ?? "").localeCompare(one.updatedAt ?? ""),
		);
}

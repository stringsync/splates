import { color, type Logger } from "webappwiz/log";
import { fail } from "../exit";
import { pushedLine, type TaskBranches } from "../merge";
import { type AgentPick, pickAgent, type RosterAgent } from "../models";
import type { Dispatched } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * Hands a task under way to another agent, which `splates server` starts in its
 * tree, told `[SPLATES HANDOFF <task>]`, to carry on from where its `SPLATES.md`
 * says it stands. The new agent answers to the person, as the old one did:
 * the task's caller goes, so nobody else tells it anything or hears from it,
 * but for a lane's orchestrator that started the old one, which goes on
 * hearing when it stops.
 * Only the conversation working the task hands it off.
 */
export async function handoff(
	{
		service,
		log,
		branches,
	}: { service: WorktreeService; log: Logger; branches: TaskBranches },
	task: string,
	to: Omit<Dispatched, "conversation" | "pending" | "handoff">,
	agents: RosterAgent[],
): Promise<AgentPick> {
	const found = await service.find(task);
	if (found.state === null || !found.exists) {
		fail(
			"not_found",
			`no task '${task}' with a worktree: run \`splates list\` to see what there is`,
			{ task },
		);
	}
	// The conversation at work on it: the agent it was handed to, or else the
	// one that added it and followed it in.
	const working = found.state.dispatch?.conversation ?? found.caller;
	const here = service.ps.env("SPLATES_CONVERSATION");
	if (here !== undefined && working !== null && working !== here) {
		fail(
			"usage",
			`'${task}' is worked by conversation ${working}: only the agent at work on a task hands it off`,
			{ task, conversation: working },
		);
	}
	const picked = { ...to, ...pickAgent(agents, to.agent, to.model, { task }) };
	await found.save({
		// A lane's orchestrator that started this one goes on hearing of the
		// task, from the agent it goes to.
		caller: service.ps.env("SPLATES_STARTED_BY"),
		dispatch: { ...picked, handoff: true },
		// The tree is the new agent's, which may claim it from another host.
		lease: null,
	});
	const pushed = pushedLine(await branches.pushTree(found), "pushed");
	log.info(
		[
			`${color.green("handed off")} ${task}`,
			...(pushed === null ? [] : [pushed]),
			`  agent:    ${picked.agent}${picked.model === undefined ? "" : ` (${picked.model})`}, which \`splates server\` starts in the worktree`,
			"  next:     end your turn: the task is the new agent's now, and the page shows the handoff",
		].join("\n"),
	);
	return picked;
}

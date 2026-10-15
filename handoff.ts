import { color, type Logger } from "webappwiz/log";
import { fail } from "./exit";
import { type AgentPick, pickAgent, type RosterAgent } from "./roster";
import type { Dispatched } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * Hands a task under way to another agent, which `arbor dev` starts in its
 * tree, told `[ARBOR HANDOFF <task>]`, to carry on from where its `ARBOR.md`
 * says it stands. The new agent answers to the person, as the old one did:
 * the task's caller goes, so nobody else tells it anything or hears from it.
 * With `relay`, for an agent that hands on work it judged another model fits
 * better, the new agent answers to this conversation instead, as to a lane's
 * orchestrator: it reports back here, and is told what the person says.
 * Only the conversation working the task hands it off; one that answers to an
 * orchestrator escalates instead, for the orchestrator to decide.
 */
export async function handoff(
	{ service, log }: { service: WorktreeService; log: Logger },
	task: string,
	to: Omit<Dispatched, "conversation" | "pending" | "handoff">,
	agents: RosterAgent[],
	{ relay = false }: { relay?: boolean } = {},
): Promise<AgentPick> {
	const handedBy = service.ps.env("ARBOR_CALLER");
	if (handedBy !== undefined) {
		fail(
			"usage",
			`this agent answers to conversation ${handedBy}, which hands its tasks out: escalate, saying which agent should take '${task}' over`,
			{ task, caller: handedBy },
		);
	}
	const found = await service.find(task);
	if (found.state === null || !found.exists) {
		fail(
			"not_found",
			`no task '${task}' with a worktree: run \`arbor list\` to see what there is`,
			{ task },
		);
	}
	// The conversation at work on it: the agent it was handed to, or else the
	// one that added it and followed it in.
	const working = found.state.dispatch?.conversation ?? found.caller;
	const here = service.ps.env("ARBOR_CONVERSATION");
	if (here !== undefined && working !== null && working !== here) {
		fail(
			"usage",
			`'${task}' is worked by conversation ${working}: only the agent at work on a task hands it off`,
			{ task, conversation: working },
		);
	}
	// Nothing reports back to a conversation `arbor dev` does not run.
	if (relay && here === undefined) {
		fail(
			"usage",
			"--relay needs `arbor dev`, which starts the agent and carries its reports back: work the task yourself, or hand it to a subagent of your own harness",
			{ task },
		);
	}
	const picked = { ...to, ...pickAgent(agents, to.agent, to.model, { task }) };
	await found.save({
		caller: relay ? here : undefined,
		dispatch: { ...picked, handoff: true },
	});
	log.info(
		[
			`${color.green("handed off")} ${task}`,
			`  agent:    ${picked.agent}${picked.model === undefined ? "" : ` (${picked.model})`}, which \`arbor dev\` starts in the worktree`,
			relay
				? `  next:     say "## ⏳ Working ${task}: on <agent>" and end your turn: it reports back to you`
				: "  next:     end your turn: the task is the new agent's now, and the page shows the handoff",
		].join("\n"),
	);
	return picked;
}

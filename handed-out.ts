import type { Resource } from "webappwiz/disposable";
import type { Logger } from "webappwiz/log";
import type { Conversations } from "./conversations";
import { idleReference } from "./prompts";
import type { WorktreeService } from "./worktree-service";

/**
 * Keeps the conversation that handed tasks out with `arbor add --agent` up
 * to date on the agents it handed them to, so it never waits on one that
 * has gone quiet. When an agent's turn ends, idle or failed, with its task
 * still under way and not escalated, nothing else tells that one, so it is
 * told `[ARBOR IDLE <task>]`. When it ends with the task gone, the agent's
 * conversation is archived with that one, off the list.
 */
export function watchHandedOut({
	service,
	conversations,
	log,
}: {
	service: WorktreeService;
	conversations: Conversations;
	log: Logger;
}): Resource {
	const check = async (id: string): Promise<void> => {
		const conversation = await conversations.find(id);
		const { state } = conversation;
		const task = state.task ?? state.lastTask;
		if (state.handedBy === null || state.archived || task === null) {
			return;
		}
		const worktree = await service.find(task);
		const caller = (await conversations.list()).find(
			(each) => each.id === state.handedBy,
		);
		if (worktree.gone) {
			await conversation.archive(caller?.id);
			return;
		}
		// A checkpoint's turn ends for a restart, not on the task, and one
		// stopped mid-turn was stopped by whoever stopped it, who knows.
		if (
			(state.status !== "idle" && state.status !== "failed") ||
			state.checkpoint !== null ||
			worktree.state?.status === "escalated" ||
			caller === undefined ||
			caller.state.archived
		) {
			return;
		}
		await caller.prompt(idleReference(task));
	};
	const unlisten = conversations.events.on("ended", (id) => {
		void check(id).catch((error: unknown) =>
			log.error(
				`arbor dev could not check on handed-out conversation ${id}: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	});
	return { dispose: unlisten };
}

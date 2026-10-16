import type { Logger } from "webappwiz/log";
import type { Conversations } from "./conversations";
import { modelOption } from "./models";
import { handoffReference, taskReference } from "./prompts";
import type { WorktreeService } from "./worktree-service";

/**
 * Starts the agent of each task `arbor add --agent` or `arbor handoff` handed
 * to one and that has none yet, in the task's tree, on the model asked for,
 * told to claim it, or to take it over for a handoff. The
 * conversation it starts goes on the record before the agent is told
 * anything, so a task is started once however often this runs, as long as
 * no two runs overlap. Answers once each is started, not told.
 */
export async function startDispatched({
	service,
	conversations,
	log,
}: {
	service: WorktreeService;
	conversations: Conversations;
	log: Logger;
}): Promise<void> {
	for (const worktree of await service.list()) {
		const dispatch = worktree.state?.dispatch;
		if (
			dispatch === undefined ||
			dispatch.conversation !== undefined ||
			dispatch.pending === true ||
			!worktree.exists
		) {
			continue;
		}
		const conversation = await conversations.start(dispatch.agent, {
			task: worktree.task,
			base: worktree.base,
			caller: worktree.caller,
			cwd: worktree.path,
			model: dispatch.model,
			assigned: true,
			// One handed on with `--relay` answers to whoever handed it on; one
			// a lane's orchestrator handed out answers to the person, and that
			// one only hears when it stops.
			...((dispatch.relay ?? dispatch.handoff === true)
				? { handedBy: worktree.caller }
				: { startedBy: worktree.caller }),
		});
		await worktree.save({
			dispatch: { ...dispatch, conversation: conversation.id },
		});
		// Each agent takes its time to start, so none waits on another's.
		void (async () => {
			await conversation.prompt(
				[
					dispatch.handoff === true
						? handoffReference(worktree.task)
						: taskReference(worktree.task),
					dispatch.prompt ?? "",
				]
					.filter((each) => each !== "")
					.join("\n\n"),
				[],
				undefined,
				// Said by whoever handed it out, not by the person.
				worktree.caller === null ? {} : { told: worktree.caller },
			);
			// Told once the session is open, so its settings are known by now.
			if (
				dispatch.model !== undefined &&
				modelOption(conversation.state.settings, dispatch.model) === null
			) {
				log.error(
					`${dispatch.agent} offers no model '${dispatch.model}': ${worktree.task} started on its own`,
				);
			}
		})().catch((error: unknown) =>
			log.error(
				`${dispatch.agent} did not take ${worktree.task}: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
	}
}

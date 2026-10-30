import type { Logger } from "webappwiz/log";
import type { Conversations } from "../conversations";
import { pickSettings } from "../models";
import type { HeldConversations } from "../queue";
import type { WorktreeService } from "../tasks";

/**
 * Lists the conversations the queue holds for tasks not yet started, for
 * the queue to start. Each waits in the main tree on the agent, model and
 * thinking level its task names, titled for its task.
 */
export function heldFor(
	conversations: Conversations,
	service: WorktreeService,
	log: Logger,
): HeldConversations {
	const root = service.git.root;
	return {
		list: async () => {
			const handed = new Set(
				(await service.list()).flatMap(
					(worktree) => worktree.state?.dispatch?.held ?? [],
				),
			);
			return (await conversations.list()).flatMap(({ state }) =>
				state.heldForTask === null || state.archived
					? []
					: [
							{
								id: state.id,
								queued: state.heldForTask,
								agent: state.agent,
								createdAt: state.createdAt,
								handed: handed.has(state.id),
							},
						],
			);
		},
		hold: async (queued, pick) => {
			const offered = (await conversations.settings())[pick.agent] ?? [];
			await conversations.start(pick.agent, {
				task: null,
				cwd: root,
				model: pick.model,
				settings: pickSettings(pick.effort, offered),
				assigned: true,
				automatic: false,
				heldForTask: queued.id,
				title: `#${queued.id} ${queued.subject}`,
			});
		},
		place: (id, spot) =>
			void conversations
				.find(id)
				.then((conversation) => {
					conversation.hold();
					conversation.waitsAt(spot);
				})
				.catch((error: unknown) =>
					log.error(
						`could not place held conversation ${id}: ${String(error)}`,
					),
				),
		drop: async (id) => (await conversations.find(id)).archive(),
	};
}

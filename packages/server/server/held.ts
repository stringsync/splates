import type { Logger } from "webappwiz/log";
import type { Conversations } from "../conversations";
import { effortSettings } from "../models";
import type { HeldConversations } from "../queue";
import type { WorktreeService } from "../tasks";

/**
 * The queue's held conversations, among `conversations`: each in the main
 * tree until its task starts, on the agent, model and thinking
 * level its task names, called by its task until its agent names it.
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
				state.queued === null || state.archived
					? []
					: [
							{
								id: state.id,
								queued: state.queued,
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
				settings: effortSettings(pick.effort, offered),
				assigned: true,
				capped: true,
				queued: queued.id,
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

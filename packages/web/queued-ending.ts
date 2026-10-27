import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Ending } from "@stringsync/splates-server/plans/browser";
import { useContext } from "react";
import { Board } from "./board";
import { queueAsked, reportedAs } from "./conversation-names";
import { QueueWork } from "./queue-work";

/** What a conversation's mark and status show of its ending, `done` once its queue card is queued. */
export function useEnding(conversation: ConversationState | null): {
	reported: Ending | null;
	queued: boolean;
} {
	const board = useContext(Board);
	const reported = conversation === null ? null : reportedAs(conversation);
	// Still in a task's worktree, it has changes yet to merge: not done.
	const asked =
		conversation === null || conversation.task !== null
			? null
			: queueAsked(conversation);
	if (reported !== null || asked === null) {
		return { reported, queued: false };
	}
	const work = new QueueWork(asked, board);
	const queued = !work.gone && work.queued;
	return { reported: queued ? "done" : null, queued };
}

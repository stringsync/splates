import type { ThreadMessageLike } from "@assistant-ui/react";
import type { ConversationState } from "@splates/server/conversations";
import type { Failed } from "./agent-failed";
import { like } from "./thread-messages";

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * `thread` with the error that ended its last turn as a `data-failed` part on
 * its last reply, or on a reply of its own when the thread ends otherwise.
 * None while the conversation waits in the queue, which says so itself.
 */
export function failed(
	thread: ThreadMessageLike[],
	conversation: ConversationState,
): ThreadMessageLike[] {
	const { error, queue } = conversation;
	if (error === null || queue !== null) {
		return thread;
	}
	const part: LikePart = {
		type: "data-failed",
		data: { error, stopped: conversation.status === "failed" } satisfies Failed,
	};
	const last = thread.at(-1);
	if (last?.role === "assistant" && typeof last.content !== "string") {
		return [
			...thread.slice(0, -1),
			{ ...last, content: [...last.content, part] },
		];
	}
	const own = like(
		{ role: "agent", parts: [], plan: null, at: null, until: null },
		thread.length,
		conversation.id,
	);
	return [...thread, { ...own, content: [part] }];
}

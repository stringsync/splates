import {
	type AppendMessage,
	type AssistantRuntime,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useMemo, useRef } from "react";
import type { ConversationState } from "../conversations";
import { useAdapters } from "./adapters";
import { filesOf, noted, said, useDraft } from "./composer-drafts";
import {
	cancelConversation,
	promptConversation,
	sendQueuedNow,
} from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import type { Drafts } from "./drafts";
import type { ThreadMessages } from "./thread-messages";

/**
 * The assistant-ui runtime a conversation's thread runs on, and how it sends:
 * a message the server refuses goes back into the composer, as the draft it
 * was, and is said above it.
 */
export function useThreadRuntime(
	conversation: ConversationState,
	feed: ConversationFeed,
	drafts: Drafts,
	{ messages, running }: ThreadMessages,
	refused: (title: string, error: unknown) => void,
): ThreadRuntime {
	const { id, status } = conversation;
	// Filled in by `useDraft` below, which needs the runtime this needs.
	const restore = useRef<(text: string, files: File[]) => void>(() => {});
	const send = useCallback(
		async (text: string, files: File[]) => {
			// The server says nothing of it until the agent is back up.
			const sending =
				status !== "idle" &&
				status !== "running" &&
				(text !== "" || files.length > 0)
					? feed.send(id, noted(text, files), files)
					: null;
			await promptConversation(id, noted(text, files), files).catch(
				(error: unknown) => {
					if (sending !== null) {
						feed.sent(id, sending);
					}
					restore.current(text, files);
					refused("Not sent", error);
					throw error;
				},
			);
		},
		[id, status, feed, refused],
	);
	const say = useCallback(
		(message: AppendMessage) => send(said(message), filesOf(message)),
		[send],
	);
	const adapters = useAdapters();
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		// A stopped conversation takes a prompt, which resumes it, unarchiving
		// an archived one, and one still starting holds it until the session
		// opens.
		convertMessage: (message: ThreadMessageLike) => message,
		adapters,
		onNew: say,
		// So the composer takes a message while the agent works. The server
		// decides whether it joins the turn or waits for its end, and shows it
		// in the thread either way, so nothing waits here.
		queue: useMemo(
			() => ({
				items: [],
				steerItems: [],
				enqueue: (message: AppendMessage) => void say(message).catch(() => {}),
				// Every message sent mid-turn comes here; only ⌘⇧↵ sets `steer`,
				// which sends it now, stopping the turn for an agent that cannot
				// take it mid-turn.
				steer: (message: AppendMessage) =>
					void say(message)
						.then(() => (message.steer ? sendQueuedNow(id) : undefined))
						.catch(() => {}),
				move: () => {},
				edit: () => {},
				remove: () => {},
			}),
			[say, id],
		),
		onCancel: async () => {
			await cancelConversation(id).catch((error: unknown) =>
				refused("Not cancelled", error),
			);
		},
	});
	restore.current = useDraft(runtime, drafts, id);
	return { runtime, send };
}

/** What `useThreadRuntime` gives a thread. */
export interface ThreadRuntime {
	runtime: AssistantRuntime;
	/** Sends `text` and `files` as the person's next message. */
	send: (text: string, files: File[]) => Promise<void>;
}

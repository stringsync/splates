import {
	type AppendMessage,
	type AssistantRuntime,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useCallback, useMemo, useRef } from "react";
import type { ConversationState } from "../conversations";
import { useAdapters } from "./adapters";
import { filesOf, noted, said, useDictated, useDraft } from "./composer-drafts";
import {
	cancelConversation,
	promptConversation,
	sendQueuedNow,
} from "./conversation-api";
import type { ConversationFeed, Sending } from "./conversation-feed";
import type { Drafts } from "./drafts";
import type { ThreadMessages } from "./thread-messages";

/**
 * The assistant-ui runtime a conversation's thread runs on, and how it sends:
 * a message shows at once, and one the server refuses stays at the thread's
 * foot as unsent, to send again or edit.
 */
export function useThreadRuntime(
	conversation: ConversationState,
	feed: ConversationFeed,
	drafts: Drafts,
	{ messages, running }: ThreadMessages,
	refused: (title: string, error: unknown) => void,
): ThreadRuntime {
	const { id } = conversation;
	const send = useCallback(
		async (text: string, files: File[], dictated = false) => {
			// Shown at once, with its reply's place or among what is queued,
			// rather than once the server says it back: the round trip, slow over
			// a tunnel and longer still while the agent comes back up, would leave
			// the thread as it was, then jump.
			const sending =
				text !== "" || files.length > 0
					? feed.send(id, noted(text, files), files, text, dictated)
					: null;
			await promptConversation(
				id,
				noted(text, files),
				files,
				dictated,
				sending?.id,
			).catch((error: unknown) => {
				// Kept where it shows, marked unsent, to send again or edit.
				if (sending !== null) {
					feed.refused(id, sending, error);
				} else {
					refused("Not sent", error);
				}
				throw error;
			});
		},
		[id, feed, refused],
	);
	/** Sends `message` again, refused before. */
	const retry = useCallback(
		(message: Sending) => {
			feed.take(id, message);
			void send(message.typed, message.attached, message.dictated).catch(
				() => {},
			);
		},
		[id, feed, send],
	);
	// Set once the runtime is made, which `say` is handed to.
	const dictated = useRef<() => boolean>(() => false);
	const say = useCallback(
		(message: AppendMessage) => {
			const text = said(message);
			return send(text, filesOf(message), text !== "" && dictated.current());
		},
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
	useDraft(runtime, drafts, id);
	dictated.current = useDictated(runtime);
	/** Puts `message`, refused before, back in the composer, after what is typed there. */
	const edit = useCallback(
		(message: Sending) => {
			feed.take(id, message);
			const composer = runtime.thread.composer;
			const typed = composer.getState().text;
			composer.setText(
				typed === "" ? message.typed : `${typed}\n\n${message.typed}`,
			);
			for (const file of message.attached) {
				void composer.addAttachment(file);
			}
		},
		[id, feed, runtime],
	);
	return { runtime, send, retry, edit };
}

/** What `useThreadRuntime` gives a thread. */
export interface ThreadRuntime {
	runtime: AssistantRuntime;
	/** Sends `text` and `files` as the person's next message, said into the mic when `dictated`. */
	send: (text: string, files: File[], dictated?: boolean) => Promise<void>;
	/** Sends a message the server refused again. */
	retry: (message: Sending) => void;
	/** Puts a message the server refused back in the composer. */
	edit: (message: Sending) => void;
}

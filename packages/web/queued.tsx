import type { AssistantRuntime } from "@assistant-ui/react";
import type { ConversationState, Message } from "@splates/server/conversations";
import { textOf } from "@splates/server/conversations/browser";
import type { RefObject } from "react";
import { focusComposer } from "./composer-editor";
import { sendQueuedNow, unqueueConversation } from "./conversation-api";
import { useExpect, usePendingConversation } from "./expecting";
import type { HeldEdits } from "./unsent";

/** Send queued messages now, take one back to edit, or throw one away. */
export function useQueueEdits(
	id: string,
	runtime: AssistantRuntime,
	section: RefObject<HTMLElement | null>,
	refused: (title: string, error: unknown) => void,
): QueueEdits {
	// One pending write per conversation, shared with the halted Send, so
	// no two of its buttons are in flight at once.
	const expect = useExpect();
	const pending = usePendingConversation(id);
	const unchanged = (state: ConversationState) => state;
	// Stops the turn so what is queued goes out now.
	const sendNow = () =>
		pending
			? Promise.resolve()
			: expect(id, unchanged, sendQueuedNow(id)).catch((error: unknown) =>
					refused("Not sent", error),
				);
	// Back into the composer to edit, ahead of anything typed there since: once
	// the server has taken it back, its words and files together, so the
	// composer never shows a message the server still holds.
	const edit = async (index: number, message: Message) => {
		if (pending) {
			return;
		}
		const request = unqueueConversation(id, index);
		const taken = await expect(id, unchanged, request)
			.then(() => request)
			.catch((error: unknown) => {
				refused("Not taken back", error);
				return null;
			});
		if (taken === null) {
			return;
		}
		const text = textOf(message);
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`,
		);
		focusComposer(section.current);
		for (const file of taken.files ?? []) {
			void composer.addAttachment(file);
		}
	};
	// Gone before the agent hears it, its words with it.
	const discard = (index: number) =>
		pending
			? Promise.resolve()
			: expect(id, unchanged, unqueueConversation(id, index)).catch(
					(error: unknown) => refused("Not discarded", error),
				);
	return { sendNow, edit, discard, busy: pending };
}

/** What the row above the composer does with what the server holds for the agent. */
export function heldEdits(
	state: ConversationState,
	edits: QueueEdits,
): HeldEdits {
	return {
		conversation: state.id,
		onEdit: (index, message) => void edits.edit(index, message),
		onDiscard: (index) => void edits.discard(index),
		// Not while the agent is held for a task or starting: there is no turn to stop.
		onSendNow:
			state.status === "starting" || state.heldForTask !== null
				? null
				: () => void edits.sendNow(),
		busy: edits.busy,
	};
}

/** What `useQueueEdits` gives a thread. */
export interface QueueEdits {
	sendNow: () => Promise<void>;
	edit: (index: number, message: Message) => Promise<void>;
	discard: (index: number) => Promise<unknown>;
	/** Sending or discarding is on its way. */
	busy: boolean;
}

/** Keyboard shortcuts for the queue above the composer. */
export function queueKeyDown(
	event: React.KeyboardEvent<HTMLElement>,
	runtime: AssistantRuntime,
	{
		queued,
		running,
		pending,
		touch,
		sendNow,
		edit,
	}: {
		queued: Message[];
		running: boolean;
		/** A message of the person's is still on its way, behind what is queued. */
		pending: boolean;
		touch: boolean;
		sendNow: () => void;
		edit: QueueEdits["edit"];
	},
): void {
	const box = event.target as HTMLElement;
	const last = queued.at(-1);
	if (
		event.key === "Enter" &&
		!touch &&
		!event.shiftKey &&
		box.getAttribute("aria-label") === "Message input" &&
		runtime.thread.composer.getState().text === "" &&
		running &&
		queued.length > 0
	) {
		event.preventDefault();
		event.stopPropagation();
		void sendNow();
		return;
	}
	if (
		event.key === "ArrowUp" &&
		box.getAttribute("aria-label") === "Message input" &&
		runtime.thread.composer.getState().text === "" &&
		last !== undefined &&
		!pending
	) {
		event.preventDefault();
		void edit(queued.length - 1, last);
	}
}

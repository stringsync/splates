import type { AssistantRuntime } from "@assistant-ui/react";
import type { Message } from "@stringsync/splates-server/conversations";
import { textOf } from "@stringsync/splates-server/conversations/browser";
import type { RefObject } from "react";
import { focusComposer } from "./composer-editor";
import { unqueueConversation } from "./conversation-api";

/**
 * Takes the `index`th message queued for the turn's end back into the
 * composer to edit, ahead of anything typed there since: its words at once,
 * as shown, its files once the server hands them back, and the composer as
 * it was should the server refuse.
 */
export function useTakeBack(
	id: string,
	runtime: AssistantRuntime,
	section: RefObject<HTMLElement | null>,
	refused: (title: string, error: unknown) => void,
): (index: number, message: Message) => Promise<void> {
	return async (index, message) => {
		const text = textOf(message);
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		const editing =
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`;
		composer.setText(editing);
		focusComposer(section.current);
		const taken = await unqueueConversation(id, index).catch(
			(error: unknown) => {
				// Unless typed into since, which is the newer draft.
				if (composer.getState().text === editing) {
					composer.setText(typed);
				}
				refused("Not taken back", error);
				return null;
			},
		);
		for (const file of taken?.files ?? []) {
			void composer.addAttachment(file);
		}
	};
}

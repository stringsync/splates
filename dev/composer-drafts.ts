import type {
	AppendMessage,
	AssistantRuntime,
	AttachmentAdapter,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Annotation } from "#dev/annotation.ts";
import type { Reply } from "./card-reply";
import { promptConversation } from "./conversation-api";
import { SEEN } from "./conversation-feed";
import type { Drafts } from "./drafts";

/**
 * Keeps what is typed in `runtime`'s composer in `drafts` under `key`, and
 * puts it back as the composer comes up, so leaving for another conversation
 * loses nothing. Hands back what puts text back after a send was refused.
 */
export function useDraft(
	runtime: AssistantRuntime,
	drafts: Drafts,
	key: string,
): (text: string, files: File[]) => void {
	useEffect(() => {
		const composer = runtime.thread.composer;
		// Into an empty composer only: what is typed there is the newer draft.
		const fill = () => {
			const kept = drafts.read(key);
			if (kept !== "" && composer.getState().isEmpty) {
				composer.setText(kept);
			}
		};
		const unsubscribe = composer.subscribe(() =>
			drafts.write(key, composer.getState().text),
		);
		fill();
		// Written from elsewhere: a message Home could not send to it.
		const unlisten = drafts.events.on("written", (written) => {
			if (written === key) {
				fill();
			}
		});
		return () => {
			unsubscribe();
			unlisten();
		};
	}, [runtime, drafts, key]);
	return (text, files) => {
		const composer = runtime.thread.composer;
		// Typed again since it was sent: that is the newer draft.
		if (!composer.getState().isEmpty) {
			return;
		}
		composer.setText(text);
		for (const file of files) {
			void composer.addAttachment(file);
		}
	};
}

/**
 * Whether the words `runtime`'s composer last sent were dictated: any take
 * into them counts, edited after or not, until the composer is emptied by
 * hand. Read as the message goes, after the composer has let go of its
 * words, so it answers for the words it last held.
 */
export function useDictated(runtime: AssistantRuntime): () => boolean {
	// Whether the words in the composer now came, even in part, from the mic.
	const now = useRef(false);
	// `now` as the composer last held any words.
	const held = useRef(false);
	useEffect(() => {
		const composer = runtime.thread.composer;
		return composer.subscribe(() => {
			const { dictation, text } = composer.getState();
			if (dictation !== undefined) {
				now.current = true;
			} else if (text === "") {
				now.current = false;
			}
			if (text !== "") {
				held.current = now.current;
			}
		});
	}, [runtime]);
	return () => {
		const was = held.current;
		held.current = false;
		return was;
	};
}

/** What `message` says, its directives among its words; its files go apart. */
export function said(message: AppendMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * `text` as the agent is sent it: then the notes on the marks drawn on the
 * images among `files`, which it reads beside the numbers drawn in. A message that comes
 * back to the composer unsent comes back as `text`, its images still marked
 * up, so the notes are not said twice.
 */
export function noted(text: string, files: readonly File[]): string {
	// Counted among the images, as their chips are.
	const images = files.filter((file) => SEEN.includes(file.type));
	return [text, Annotation.notesFor(images)]
		.filter((each) => each !== "")
		.join("\n\n");
}

/**
 * Any file, held as it is until the message goes: an image the agent can be
 * sent as one is an image, to mark up, and the server sends the agent a link
 * to anything else.
 */
export const FILES: AttachmentAdapter = {
	accept: "*",
	add: async ({ file }) => ({
		id: crypto.randomUUID(),
		type: SEEN.includes(file.type) ? "image" : "file",
		name: file.name,
		contentType: file.type,
		file,
		status: { type: "requires-action", reason: "composer-send" },
	}),
	// Read from the file itself as the message goes, so never into memory here.
	send: async (attachment) => ({
		...attachment,
		status: { type: "complete" },
		content: [],
	}),
	remove: async () => {},
};

/** The files attached to `message`. */
export function filesOf(message: AppendMessage): File[] {
	return (message.attachments ?? []).flatMap((each) =>
		each.file === undefined ? [] : [each.file],
	);
}

/**
 * What the cards in conversation `id` answer through: what they send goes to
 * it, and what one keeps goes in `drafts` beside the composer's own.
 */
export function useReply(
	id: string,
	drafts: Drafts,
	/** Whether its cards send anything, which a handed-out task's do not. */
	sends = true,
): Reply {
	return useMemo(
		() => ({
			send: sends ? (said: string) => promptConversation(id, said) : null,
			drafts: {
				read: (name: string) => drafts.read(`${id}:${name}`),
				write: (name: string, kept: string) =>
					drafts.write(`${id}:${name}`, kept),
			},
		}),
		[id, drafts, sends],
	);
}

/** Whether `runtime`'s composer holds anything typed. */
export function useTyped(runtime: AssistantRuntime): boolean {
	const composer = runtime.thread.composer;
	const [typed, setTyped] = useState(() => composer.getState().text !== "");
	useEffect(
		() => composer.subscribe(() => setTyped(composer.getState().text !== "")),
		[composer],
	);
	return typed;
}

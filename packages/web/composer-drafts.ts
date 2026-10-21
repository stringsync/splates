import type {
	AppendMessage,
	AssistantRuntime,
	AttachmentAdapter,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Annotation } from "#web/annotation.ts";
import { ATTACHMENT_REFERENCE, attachmentName } from "./attachment-chips";
import type { Reply } from "./card-reply";
import { SEEN } from "./conversation-feed";
import type { Drafts } from "./drafts";
import { fileShelf } from "./files";

/**
 * Keeps what is typed in `runtime`'s composer in `drafts` under `key`, and
 * the files attached to it, and puts them back as the composer comes up, so
 * leaving for another conversation loses nothing. Hands back what puts text
 * back after a send was refused.
 */
// scry-ignore classes-over-function-exports: useDraft and useReply are React hooks, called by components, which a class's methods cannot be
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
			// Read first: setting the text keeps the composer's files, none yet.
			const files = drafts.files(key);
			const { isEmpty, text, attachments } = composer.getState();
			if ((kept !== "" || files.length > 0) && isEmpty) {
				composer.setText(kept);
				for (const file of files) {
					void composer.addAttachment(file);
				}
			} else if (attachments.length === 0 && text === kept) {
				// The draft's files, back after a reload once its words were.
				for (const file of files) {
					void composer.addAttachment(file);
				}
			}
		};
		const unsubscribe = composer.subscribe(() => {
			const { text, attachments } = composer.getState();
			drafts.write(key, text);
			drafts.attach(
				key,
				attachments.flatMap((each) =>
					each.file === undefined ? [] : [each.file],
				),
			);
		});
		fill();
		// Written from elsewhere: a message Home could not send to it.
		const unlisten = drafts.events.on("written", (written) => {
			if (written === key) {
				fill();
			}
		});
		const unlistenDiscarded = drafts.events.on("discarded", (discarded) => {
			if (discarded === key) {
				void composer.reset();
			}
		});
		return () => {
			unsubscribe();
			unlisten();
			unlistenDiscarded();
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
 * `text` with the chip of each of `files` it never names written after its
 * words, as it would stand had the chip been left in them, so the sent message
 * draws it in the line with them rather than in a row above.
 */
export function named(text: string, files: readonly File[]): string {
	const called = new Set(
		[...text.matchAll(new RegExp(ATTACHMENT_REFERENCE.source, "g"))].map(
			(found) => found[1],
		),
	);
	const counts = { image: 0, file: 0 };
	const loose = files.flatMap((file) => {
		const shelf = fileShelf(file);
		const name = attachmentName(shelf, counts[shelf]++);
		return called.has(name) ? [] : [`[${name}]`];
	});
	return [text, ...loose].filter((each) => each !== "").join(" ");
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
 * What the cards in conversation `id` answer through: what they send goes
 * out through `send`, the thread's own, so it shows at once as the
 * composer's does, and what one keeps goes in `drafts` beside the
 * composer's own. Null `send` where its cards send nothing, as a handed-out
 * task's.
 */
export function useReply(
	id: string,
	drafts: Drafts,
	send:
		| ((text: string, files: File[], dictated?: boolean) => Promise<void>)
		| null,
): Reply {
	// Whether a take went into a card's box since the last send.
	const dictated = useRef(false);
	return useMemo(
		() => ({
			send:
				send === null
					? null
					: (said: string, files: readonly File[] = []) => {
							const was = dictated.current && said !== "";
							dictated.current = false;
							return send(said, [...files], was);
						},
			dictated: () => {
				dictated.current = true;
			},
			drafts: {
				read: (name: string) => drafts.read(`${id}:${name}`),
				write: (name: string, kept: string) =>
					drafts.write(`${id}:${name}`, kept),
			},
		}),
		[id, drafts, send],
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

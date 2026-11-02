import type { Attached, Image, Message } from "@splates/server/conversations";
import { Duration } from "core/time";

/** How long a message goes unanswered before the page says it is still sending. */
export const STILL_SENDING = Duration.secs(3);

/**
 * How long a message looks sent, in the thread, before it is held in the row
 * above the composer as waiting. When the server will queue it, show it
 * above the composer immediately instead of making it look sent.
 */
export function heldAfter(queue = false): Duration {
	return Duration.ms(queue ? 0 : heldAfterMs);
}

/**
 * Whether a message said to `conversation` now waits behind a running turn,
 * and so is held at once. One said while its agent is still starting looks
 * sent, as it does when the agent is idle, rather than queued.
 */
export function queuesNow(conversation: {
	taking: string;
	status: string;
}): boolean {
	return conversation.taking === "queue" && conversation.status === "running";
}

let heldAfterMs = Duration.secs(5).ms;

/** Tests shorten the wait before a message is held above the composer. */
export function setHeldAfterMs(ms: number): void {
	heldAfterMs = ms;
}

/** How long the page waits for a prompt acknowledgement. */
export const SEND_TIMEOUT = Duration.secs(30);

/** A message on its way: its words, and its files read from the page's own copies. */
export interface Sending {
	/** The page's id for it, which the server's own copy of it carries back. */
	id: string;
	text: string;
	images: Image[];
	files: Attached[];
	/** What the person wrote and attached, to send again or take back. */
	typed: string;
	attached: File[];
	/** Whether the person said it into the mic. */
	dictated: boolean;
	/** When it was sent, as epoch ms, to tell when it has gone unanswered for `STILL_SENDING`. */
	at: number;
}

/** A message the server refused, with why: shown until sent again or taken back. */
export interface Unsent {
	message: Sending;
	why: string;
}

/** `message` as the thread shows it, from the page's own copies of its files. */
export function messageOf(message: Sending): Message {
	return {
		id: message.id,
		role: "user",
		parts: [
			...message.images.map((image) => ({ type: "image" as const, ...image })),
			...message.files.map((file) => ({ type: "file" as const, ...file })),
			...(message.text === ""
				? []
				: [{ type: "text" as const, text: message.text }]),
		],
		plan: null,
		at: null,
		until: null,
		sending: message.at,
		...(message.dictated ? { dictated: true as const } : {}),
	};
}

/** Lets go of the page's copies of `message`'s files. */
export function forget(message: Sending): void {
	for (const image of [...message.images, ...message.files]) {
		if (image.url !== undefined) {
			URL.revokeObjectURL(image.url);
		}
	}
}

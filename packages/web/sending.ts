import type {
	Attached,
	Image,
	Message,
} from "@stringsync/splates-server/conversations";
import { Duration } from "webappwiz/time";

/** How long a message goes unanswered before the page says it is still sending. */
export const STILL_SENDING = Duration.secs(3);

/** How long the page waits for a prompt acknowledgement. */
export const SEND_TIMEOUT = Duration.secs(30);

/** A message on its way: its words, and its files read from the page's own copies. */
export interface Sending {
	/** The page's id for it, which the server's own copy of it carries back. */
	id: string;
	text: string;
	images: Image[];
	files: Attached[];
	/** Whether it waits for the running turn's end, as the server will record it. */
	queued: boolean;
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
export function messageOf(message: Sending, now = message.at): Message {
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
		...(message.queued ? { queued: true as const } : {}),
		sending:
			now - message.at >= STILL_SENDING.ms
				? Math.max(
						0,
						Math.ceil(
							(SEND_TIMEOUT.ms - (now - message.at)) / Duration.secs(1).ms,
						),
					)
				: null,
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

/**
 * When a message of `sending` next needs its countdown refreshed, as epoch
 * ms: as it goes unanswered for `STILL_SENDING`, then each second after;
 * null when none is on its way.
 */
export function nextCountdown(
	sending: readonly Sending[],
	now: number,
): number | null {
	const due = sending
		.map((each) =>
			now < each.at + STILL_SENDING.ms
				? each.at + STILL_SENDING.ms
				: each.at +
					(Math.floor((now - each.at) / Duration.secs(1).ms) + 1) *
						Duration.secs(1).ms,
		)
		.filter((at) => at > now);
	return due.length === 0 ? null : Math.min(...due);
}

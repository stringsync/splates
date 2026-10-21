import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Event, JudgedNote } from "@stringsync/splates-server/records";

/** The probability a note needs to have been worth attaching, as the router tiers it. */
const WORTH = 0.5;

/** A note on a message's chips: the tier it was attached in, or null when it was skipped. */
export type Chip = Pick<JudgedNote, "path" | "tier" | "inContext" | "updated">;

/**
 * The chips of each of `said`'s messages, by index: the notes the agent was
 * pointed at for it, with those it held already, dimmed, and none for a
 * conversation held out from pointers. An event goes to the last message
 * said by the time it was recorded, as the router judges a batch once.
 */
export function chipsOf(
	said: readonly { role: string; at: string | null }[],
	events: readonly Event[],
): Map<number, Chip[]> {
	const chips = new Map<number, Chip[]>();
	for (const event of events) {
		if (
			event.action !== "notes attached" ||
			event.reason !== null ||
			event.holdout
		) {
			continue;
		}
		const index = said.findLastIndex(
			(message) =>
				message.role === "user" &&
				message.at !== null &&
				message.at <= event.at,
		);
		const shown = event.notes.filter(
			(note) =>
				note.tier !== null || (note.inContext && note.probability >= WORTH),
		);
		if (index >= 0 && shown.length > 0) {
			chips.set(index, shown);
		}
	}
	return chips;
}

/** `message` with the note chips its text came with, when it has any. */
export function withChips(
	message: ThreadMessageLike,
	chips: readonly Chip[] | undefined,
): ThreadMessageLike {
	return chips === undefined
		? message
		: {
				...message,
				metadata: { custom: { ...message.metadata?.custom, notes: chips } },
			};
}

import type { ConversationState } from "@stringsync/splates-server/conversations";
import { listed } from "@stringsync/splates-server/conversations/browser";

/** Whether `listing`, a summary, only says again what `held`, read whole, holds. */
export function repeats(
	held: ConversationState | undefined,
	listing: ConversationState,
): boolean {
	return (
		held !== undefined &&
		held.summary !== true &&
		listing.summary === true &&
		JSON.stringify(listed(held)) === JSON.stringify(listing)
	);
}

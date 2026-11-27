import type { ConversationState } from "@splates/server/conversations";
import { awaited } from "@splates/server/conversations/browser";

/**
 * Whether a conversation waits on a command running in the background that
 * its agent will come back for once it ends. The rows of the list and the
 * Widgets button spin on it; what the agent only left running does not.
 */
export function backgrounded(
	conversation: Pick<ConversationState, "background" | "wakes">,
): boolean {
	return awaited(conversation).length > 0;
}

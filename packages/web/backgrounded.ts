import type { ConversationState } from "@splates/server/conversations";

/**
 * Whether a conversation has a command running in the background that its
 * agent started. The rows of the list and the Widgets button spin on it.
 */
export function backgrounded(
	conversation: Pick<ConversationState, "background">,
): boolean {
	return conversation.background.some((each) => each.state === "running");
}

import type { Health } from "../autopick/health";
import { modelValue } from "../models";
import type { Conversation } from "./conversation";

/**
 * Hands `health` the failure `conversation` just ended a turn with, when it
 * is new since `before`, the error last seen. Answers the error now, to pass
 * as `before` next time.
 */
export function hearFault(
	health: Health | null,
	conversation: Conversation,
	before: string | null,
): string | null {
	const { error, agent, settings } = conversation.state;
	if (error !== before && typeof error === "string") {
		void health
			?.hear(agent, modelValue(settings), conversation.now(), error)
			.catch(() => {});
	}
	return error;
}

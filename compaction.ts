import type * as acp from "@agentclientprotocol/sdk";
import type { Compaction, ConversationState } from "./conversation-state";

/**
 * What Claude's adapter says of a compaction to a client without ACP's
 * compaction updates: a tool call titled "Compact conversation", its facts in
 * `_meta.jetbrains.air.contextCompaction` for a client that asked for AIR, as
 * arbor does, patched in as it learns them, the token counts after it ends.
 */
interface Facts {
	trigger?: unknown;
	preTokens?: unknown;
	postTokens?: unknown;
}

/** Whether `update` reports a compaction rather than a tool call of the agent's. */
export function isCompaction(
	update: acp.ToolCall | acp.ToolCallUpdate,
): boolean {
	const claude = update._meta?.claudeCode as { toolName?: unknown } | undefined;
	return factsIn(update) !== null || claude?.toolName === "compact";
}

function factsIn(update: acp.ToolCall | acp.ToolCallUpdate): Facts | null {
	const air = (
		update._meta?.jetbrains as
			| { air?: { contextCompaction?: unknown } }
			| undefined
	)?.air?.contextCompaction;
	return typeof air === "object" && air !== null ? (air as Facts) : null;
}

/** Takes what an update says of the compaction into it. */
export function fillCompaction(
	part: Compaction,
	update: acp.ToolCall | acp.ToolCallUpdate,
	at: string | null,
): void {
	const facts = factsIn(update) ?? {};
	if (facts.trigger === "automatic" || facts.trigger === "manual") {
		part.trigger = facts.trigger;
	}
	if (typeof facts.preTokens === "number") {
		part.before = facts.preTokens;
	}
	if (typeof facts.postTokens === "number") {
		part.after = facts.postTokens;
	}
	if (update.status === "completed" || update.status === "failed") {
		part.status = update.status;
		part.until ??= at;
	}
}

/** The compaction `id`, wherever in the conversation it was; null for none. */
export function compactionIn(
	state: ConversationState,
	id: string,
): Compaction | null {
	for (const message of state.messages) {
		for (const part of message.parts) {
			if (part.type === "compaction" && part.id === id) {
				return part;
			}
		}
	}
	return null;
}

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

/** A compaction `id` just begun at `at`, with nothing said of it yet. */
export function newCompaction(id: string, at: string | null): Compaction {
	return {
		type: "compaction",
		id,
		status: "in_progress",
		trigger: null,
		before: null,
		after: null,
		summary: null,
		at,
		until: null,
	};
}

/** The text of `blocks`, the summary's other content being nothing to show. */
function textOf(blocks: readonly acp.ContentBlock[]): string {
	return blocks
		.map((block) => (block.type === "text" ? block.text : ""))
		.join("");
}

/**
 * Takes ACP's `compaction_update` into `part`: its status, and its summary,
 * which replaces the one kept, or clears it when null or empty.
 */
export function updateCompaction(
	part: Compaction,
	update: acp.CompactionUpdate,
	at: string | null,
): void {
	if (update.status === "in_progress") {
		part.status = "in_progress";
	} else if (update.status === "completed") {
		part.status = "completed";
		part.until ??= at;
	} else if (update.status === "failed" || update.status === "cancelled") {
		part.status = "failed";
		part.until ??= at;
	}
	if (update.summary !== undefined) {
		const text = update.summary === null ? "" : textOf(update.summary);
		part.summary = text === "" ? null : text;
	}
}

/** Appends a `compaction_summary_chunk`'s text to the summary `part` keeps. */
export function appendSummary(
	part: Compaction,
	chunk: acp.CompactionSummaryChunk,
): void {
	const text = textOf([chunk.content]);
	if (text !== "") {
		part.summary = (part.summary ?? "") + text;
	}
}

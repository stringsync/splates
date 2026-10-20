import type { ConversationState } from "@stringsync/splates-server/conversations";
import { nameOf } from "@stringsync/splates-server/conversations/browser";
import { useReactive } from "@webappwiz/react";
import { useCallback, useSyncExternalStore } from "react";
import type { ConversationFeed } from "./conversation-feed";
import { lastReport } from "./conversation-names";

/**
 * Lists read conversation identity, state and reports, not streaming words or
 * token counts. Cache their projection by the immutable objects from the feed.
 * A thread must select its full conversation separately.
 */
const indexed = new WeakMap<ConversationState, string>();

interface Indexed {
	source: ConversationState[];
	rows: ConversationState[];
	entries: Map<string, { key: string; state: ConversationState }>;
}
const indexes = new WeakMap<object, Indexed>();

/** Reuse unchanged list rows, sharing the projection between all consumers. */
export function conversationIndex<State extends ConversationState>(feed: {
	conversations: State[];
}): State[] {
	const before = indexes.get(feed);
	if (before?.source === feed.conversations) {
		return before.rows as State[];
	}
	const entries = new Map<string, { key: string; state: ConversationState }>();
	const rows = feed.conversations.map((state) => {
		const key = indexKey(state);
		const id = `${"project" in state ? state.project : ""}/${state.id}`;
		const prior = before?.entries.get(id);
		const entry = prior?.key === key ? prior : { key, state };
		entries.set(id, entry);
		return entry.state;
	});
	const same =
		before !== undefined &&
		before.rows.length === rows.length &&
		rows.every((each, at) => each === before.rows[at]);
	const result = same ? before.rows : rows;
	indexes.set(feed, { source: feed.conversations, rows: result, entries });
	return result as State[];
}

/** Stable list state; select the full conversation separately for a thread. */
export function useConversationIndex(
	feed: ConversationFeed,
): ConversationState[] {
	return useReactive(feed, conversationIndex, ["changed"]);
}

/** Only the selected conversation's full state invalidates a thread. */
export function useConversation(
	feed: ConversationFeed,
	id: string | null,
): ConversationState | null {
	const subscribe = useCallback(
		(changed: () => void) => feed.events.on("changed", changed),
		[feed],
	);
	const read = useCallback(
		() => feed.conversations.find((each) => each.id === id) ?? null,
		[feed, id],
	);
	return useSyncExternalStore(subscribe, read, read);
}

function indexKey(conversation: ConversationState): string {
	const held = indexed.get(conversation);
	if (held !== undefined) {
		return held;
	}
	const { messages, events, usage, artifacts, ...state } = conversation;
	const key = JSON.stringify([
		state,
		nameOf(conversation, []),
		lastReport(conversation),
		// Questions and their answers can change while idle, without a status change.
		conversation.status === "running" || conversation.status === "starting"
			? null
			: messages,
	]);
	indexed.set(conversation, key);
	return key;
}

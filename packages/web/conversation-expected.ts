import type { ConversationState } from "@stringsync/splates-server/conversations";

/** A change `expect` shows: how, and when its write landed. */
export interface Expected {
	patch: (state: ConversationState) => ConversationState;
	/** `reads` as its write landed; null while it is on its way. */
	landedRead: number | null;
}

/**
 * Whether `state` has yet to be archived, or brought back, as `patch` would
 * have it. The server never files a conversation otherwise than asked, so a
 * streamed copy that has not is one sent before the write, arriving after its
 * answer on the other connection, and leaves the change showing.
 */
export function unfiled(
	state: ConversationState,
	patch: (state: ConversationState) => ConversationState,
): boolean {
	return patch(state).archived !== state.archived;
}

/** Whether `state` already holds what `patch` would change of it. */
export function holds(
	state: ConversationState,
	patch: (state: ConversationState) => ConversationState,
): boolean {
	const patched = patch(state);
	return (Object.keys(patched) as (keyof ConversationState)[]).every(
		(key) =>
			patched[key] === state[key] ||
			JSON.stringify(patched[key]) === JSON.stringify(state[key]),
	);
}

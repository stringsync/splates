import type { ConversationState } from "@stringsync/splates-server/conversations";

/** A write `expect` holds as pending: what it changes, and when it landed. */
export interface Expected {
	patch: (state: ConversationState) => ConversationState;
	/** `reads` as its write landed; null while it is on its way. */
	landedRead: number | null;
}

/**
 * Whether `state` has yet to be archived, or brought back, as `patch` would
 * have it. Such a streamed copy was sent before the write, so the change
 * stays pending.
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

import type { ConversationState, Message } from "./state";

/** A conversation's changed fields and message slots, relative to its last streamed copy. */
export interface ConversationDelta {
	id: string;
	changes: Partial<Omit<ConversationState, "id" | "messages">>;
	removed: (keyof ConversationState)[];
	messages?: { length: number; replace: [number, Message][] };
}

/** Tracks a connection’s conversations; call `next` for each state to send. */
export class ConversationUpdates {
	private readonly held = new Map<string, ConversationState>();

	/** Starts a new baseline, or returns only what moved since the previous copy. */
	next(state: ConversationState): ConversationState | ConversationDelta {
		const before = this.held.get(state.id);
		if (before === undefined) {
			const copy = structuredClone(state);
			this.held.set(state.id, copy);
			return copy;
		}
		const changes: ConversationDelta["changes"] = {};
		const removed: (keyof ConversationState)[] = [];
		for (const key of Object.keys(state) as (keyof ConversationState)[]) {
			if (
				key !== "id" &&
				key !== "messages" &&
				!equal(before[key], state[key])
			) {
				Object.assign(changes, { [key]: structuredClone(state[key]) });
			}
		}
		for (const key of Object.keys(before) as (keyof ConversationState)[]) {
			if (!(key in state)) {
				removed.push(key);
			}
		}
		const replace: [number, Message][] = [];
		state.messages.forEach((message, index) => {
			if (!equal(before.messages[index], message)) {
				replace.push([index, structuredClone(message)]);
			}
		});
		const delta: ConversationDelta = {
			id: state.id,
			changes,
			removed,
			...(replace.length > 0 || state.messages.length !== before.messages.length
				? { messages: { length: state.messages.length, replace } }
				: {}),
		};
		this.held.set(state.id, ConversationUpdates.apply(before, delta));
		return delta;
	}

	/** Forgets a deleted conversation so a reused id starts with a full copy. */
	drop(id: string): void {
		this.held.delete(id);
	}

	/** Applies a delta without replacing unchanged messages or their array. */
	static apply(
		before: ConversationState,
		delta: ConversationDelta,
	): ConversationState {
		const next = { ...before, ...delta.changes };
		for (const key of delta.removed) {
			delete next[key];
		}
		if (delta.messages !== undefined) {
			next.messages = before.messages.slice(0, delta.messages.length);
			for (const [index, message] of delta.messages.replace) {
				next.messages[index] = message;
			}
		}
		return next;
	}
}

/** Structural comparison also catches in-place edits to old tools and queued prompts. */
function equal(one: unknown, other: unknown): boolean {
	if (one === other) {
		return true;
	}
	if (
		one === null ||
		other === null ||
		typeof one !== "object" ||
		typeof other !== "object"
	) {
		return false;
	}
	if (Array.isArray(one) && Array.isArray(other)) {
		return (
			one.length === other.length &&
			one.every((value, index) => equal(value, other[index]))
		);
	}
	const left = one as Record<string, unknown>;
	const right = other as Record<string, unknown>;
	for (const key in left) {
		if (!Object.hasOwn(right, key) || !equal(left[key], right[key])) {
			return false;
		}
	}
	for (const key in right) {
		if (!Object.hasOwn(left, key)) {
			return false;
		}
	}
	return true;
}

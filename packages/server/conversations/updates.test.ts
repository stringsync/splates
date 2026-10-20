import { beforeEach, describe, expect, it } from "bun:test";
import { said } from "./messages";
import { blank, type ConversationState } from "./state";
import { type ConversationDelta, ConversationUpdates } from "./updates";

describe("ConversationUpdates", () => {
	let updates: ConversationUpdates;
	let state: ConversationState;
	beforeEach(() => {
		updates = new ConversationUpdates();
		state = blank("c1", "fake", null, "now");
	});
	it("starts whole, then captures in-place edits, appended messages and removed fields", () => {
		const second = said("second", null);
		const third = said("third", null);
		state.messages = [said("first", null), second];
		state.summary = true;
		const initial = updates.next(state) as ConversationState;
		expect(initial).toEqual(state);
		state.messages[1]?.parts.push({ type: "text", text: " changed" });
		state.messages.push(third);
		state.status = "running";
		delete state.summary;
		const delta = updates.next(state) as ConversationDelta;
		expect(delta).toEqual({
			id: "c1",
			changes: { status: "running" },
			removed: ["summary"],
			messages: {
				length: 3,
				replace: [
					[1, second],
					[2, third],
				],
			},
		});
		expect(delta).toHaveProperty("changes");
		const merged = ConversationUpdates.apply(initial, delta);
		expect(merged).toEqual(state);
		expect(merged.messages[0]).toBe(initial.messages[0]);
		expect(initial.messages).toHaveLength(2);
		expect(initial.messages[1]?.parts).toHaveLength(1);
	});

	it("handles deletion and reordering, and forgets deleted baselines", () => {
		state.messages = [
			said("first", null),
			said("second", null),
			said("third", null),
		];
		const initial = updates.next(state) as ConversationState;
		state.messages.splice(0, 1);
		state.messages.reverse();
		const delta = updates.next(state) as ConversationDelta;
		expect(delta).toHaveProperty("changes");
		expect(ConversationUpdates.apply(initial, delta)).toEqual(state);
		updates.drop(state.id);
		expect(updates.next(state)).toEqual(state);
	});

	it("sends only changed metadata and preserves the messages array", () => {
		const initial = updates.next(state) as ConversationState;
		state.usage.output++;
		const delta = updates.next(state) as ConversationDelta;
		expect(delta).toHaveProperty("changes");
		expect(delta.messages).toBeUndefined();
		expect(ConversationUpdates.apply(initial, delta).messages).toBe(
			initial.messages,
		);
		expect(delta.changes).toEqual({ usage: state.usage });
	});
});

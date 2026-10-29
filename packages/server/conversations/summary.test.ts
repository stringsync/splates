import { beforeEach, describe, expect, it } from "bun:test";
import { said } from "./messages";
import { blank, type ConversationState, listed } from "./state";
import { type ConversationDelta, ConversationUpdates } from "./updates";

describe("conversation summaries", () => {
	let state: ConversationState;
	beforeEach(() => {
		state = blank("c1", "fake", null, "now");
		state.messages = [said("Hello", null)];
		state.messages[0]?.parts.push({
			type: "thought",
			at: null,
			text: "thinking ".repeat(1000),
		});
		state.events = [
			{
				id: "e1",
				at: "now",
				action: "merge",
				task: "alpha",
				reason: "tests_failed",
				conversation: "c1",
				failedTests: [
					{ name: "failing test", message: "output ".repeat(30000) },
				],
			},
		];
	});

	it("keeps the agent's commands, which the composer's / lists", () => {
		state.commands = [{ name: "review", description: "Review", hint: null }];
		expect(listed(state).commands).toEqual(state.commands);
	});

	it("leaves out an archived one's commands and settings, read whole when opened", () => {
		state.archived = true;
		state.commands = [{ name: "review", description: "Review", hint: null }];
		state.settings = [
			{
				id: "mode",
				name: "Mode",
				type: "select",
				category: "mode",
				current: "auto",
				options: [{ value: "auto", name: "Auto", description: null }],
			},
		];
		expect(listed(state)).toMatchObject({ commands: [], settings: [] });
		expect(state.commands).toHaveLength(1);
	});

	it.each([false, true])(
		"omits bulky details with archived=%s without changing the whole state",
		(archived) => {
			state.archived = archived;
			const original = structuredClone(state);
			const summary = listed(state);
			expect(summary.summary).toBe(true);
			expect(summary.messages[0]?.parts).toEqual([
				{ type: "text", text: "Hello" },
			]);
			expect(summary.events).toEqual([]);
			expect(JSON.stringify(summary).length).toBeLessThan(1500);
			expect(state).toEqual(original);

			const updates = new ConversationUpdates();
			updates.next(summary);
			const delta = updates.next(state);
			expect("changes" in delta).toBe(true);
			expect(
				ConversationUpdates.apply(summary, delta as ConversationDelta),
			).toEqual(state);
		},
	);
});

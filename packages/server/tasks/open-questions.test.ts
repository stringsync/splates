import { expect, test } from "bun:test";
import type { Conversation, Conversations, Message } from "../conversations";
import { openQuestions } from "./open-questions";

test("questions from before the task began cannot block its merge", async () => {
	const open = await openQuestions(
		conversations([
			message("agent", "1. Old question?", "2026-11-05T11:00:00.000Z"),
			message("agent", "1. Current question?"),
		]),
		"second",
	);
	expect(open.map((question) => question.text)).toEqual(["Current question?"]);
});

const at = "2026-11-05T12:00:00.000Z";
function message(role: Message["role"], text: string, when = at): Message {
	return {
		role,
		parts: [{ type: "text", text }],
		plan: null,
		at: when,
		until: when,
	};
}
function conversations(messages: Message[]): Conversations {
	return {
		list: async () => [
			{
				state: {
					task: "second",
					archived: false,
					messages,
					events: [{ action: "add", task: "second", reason: null, at }],
				},
			} as Conversation,
		],
	} as unknown as Conversations;
}

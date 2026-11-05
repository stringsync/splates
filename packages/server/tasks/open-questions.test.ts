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

test("task questions honor approvals and replaced proposals", async () => {
	const proposal = "## 💡 Proposed a fix\n\n1. Keep it?\n   - (a) Yes (chosen)";
	expect(
		await openQuestions(
			conversations([
				message("agent", "## 💡 Proposed old fix\n\n1. Old question?"),
				message("agent", proposal),
				message("user", "[SPLATES APPROVE]"),
			]),
			"second",
		),
	).toEqual([]);
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

// A later task in the same conversation must not inherit earlier proposals.
test("the caption task ignores the earlier proposal exchange", async () => {
	const { default: exchange } = await import(
		"../plans/replaced-proposals.fixture.json"
	);
	const earlier = exchange.map(([role, text]) =>
		message(
			role as Message["role"],
			text as string,
			"2026-11-05T11:00:00.000Z",
		),
	);
	expect(
		await openQuestions(
			conversations([
				...earlier,
				message("agent", "1. Keep the caption below the picture?"),
				message("user", "> **Keep the caption below the picture?**\r\n\r\nYes"),
			]),
			"second",
		),
	).toEqual([]);
});

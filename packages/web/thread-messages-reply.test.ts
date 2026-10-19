import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Message, Tool } from "@stringsync/splates-server/conversations";
import { like } from "./thread-messages";

describe("like's reply", () => {
	/** The agent's turn: words, then a call it made after them. */
	const turn = (more: Partial<Message> = {}): Message => ({
		role: "agent",
		parts: [
			{ type: "text", text: "Checking the tests." },
			{
				type: "tool",
				id: "t1",
				title: "Run tests",
				status: "completed",
				kind: "execute",
				command: "bun test",
				target: null,
				output: "",
				edits: [],
				paths: [],
				parent: null,
				at: null,
				until: null,
				flags: [],
				decision: null,
			} satisfies Tool,
		],
		plan: null,
		at: null,
		until: null,
		...more,
	});
	/** The words it shows outside its work row, as its reply. */
	const reply = (message: ReturnType<typeof like>) =>
		typeof message.content === "string"
			? [message.content]
			: message.content.flatMap((part) =>
					part.type === "text" ? [part.text] : [],
				);

	it("takes a finished turn's last words as its reply, even with work after them", () => {
		expect(reply(like(turn(), 1, "c1"))).toEqual(["Checking the tests."]);
	});

	it("keeps a stopped turn's words with work after them in its row", () => {
		expect(
			reply(like(turn({ stopped: "2026-10-19T00:00:00.000Z" }), 1, "c1")),
		).toEqual([]);
	});

	it("keeps the words of a turn that went on past it in its row", () => {
		const message = like(
			turn(),
			1,
			"c1",
			true,
			null,
			undefined,
			null,
			[],
			null,
			true,
		);
		expect(reply(message)).toEqual([]);
	});

	it("still replies with a cut turn's words nothing came after", () => {
		const message = turn({ interrupted: "2026-10-19T00:00:00.000Z" });
		message.parts.reverse();
		expect(reply(like(message, 1, "c1"))).toEqual(["Checking the tests."]);
	});
});

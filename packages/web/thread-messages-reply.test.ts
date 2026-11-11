import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Message, Tool } from "@splates/server/conversations";
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

	/** The kinds of what it shows, in order. */
	const kinds = (message: ReturnType<typeof like>) =>
		typeof message.content === "string"
			? ["text"]
			: message.content.map((part) => part.type);

	it("shows a stopped turn's words with work after them above that work", () => {
		expect(
			kinds(like(turn({ stopped: "2026-10-19T00:00:00.000Z" }), 1, "c1")),
		).toEqual(["text", "data-work", "data-stopped"]);
	});

	it("shows the words of a turn that went on past them above the work after them", () => {
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
		expect(kinds(message)).toEqual(["text", "data-work"]);
	});

	it("still replies with a cut turn's words nothing came after", () => {
		const message = turn({ interrupted: "2026-10-19T00:00:00.000Z" });
		message.parts.reverse();
		expect(reply(like(message, 1, "c1"))).toEqual(["Checking the tests."]);
	});
});

import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Message } from "@splates/server/conversations";
import { like } from "./thread-messages";

describe("like", () => {
	/** The person's message carrying `parts`. */
	const said = (parts: Message["parts"]): Message => ({
		role: "user",
		parts,
		plan: null,
		at: null,
		until: null,
	});

	it("keys each attachment apart when one file is sent twice", () => {
		// A file is named for what is in it, so the same image twice shares a
		// name, and assistant-ui throws on a key it sees twice.
		const image = {
			type: "image",
			name: "48e0ad760635c656.png",
			mimeType: "image/png",
		} as const;
		const file = {
			type: "file",
			name: "9f2c.txt",
			title: "notes.txt",
			mimeType: "text/plain",
		} as const;
		const { attachments = [] } = like(
			said([image, { type: "text", text: "these two" }, image, file, file]),
			0,
			"c1",
		);

		const ids = attachments.map((each) => each.id);
		expect(ids).toHaveLength(4);
		expect(new Set(ids).size).toBe(ids.length);
		expect(attachments.map((each) => each.name)).toEqual([
			"48e0ad760635c656.png",
			"48e0ad760635c656.png",
			"notes.txt",
			"notes.txt",
		]);
	});

	it("puts a progress card in the turn at the time it began", () => {
		const agent: Message = {
			role: "agent",
			parts: [
				{ type: "text", text: "Starting." },
				{ type: "text", text: "All built." },
			],
			plan: null,
			at: "2026-01-01T00:00:00.000Z",
			until: "2026-01-01T00:05:00.000Z",
		};
		const { content } = like(
			agent,
			0,
			"c1",
			true,
			agent.at,
			Number.POSITIVE_INFINITY,
			null,
			[],
			null,
			false,
			["2026-01-01T00:01:00.000Z build"],
		);
		const parts = typeof content === "string" ? [] : content;
		const card = parts.find((part) => part.type === "data-progress");
		expect(card).toEqual({ type: "data-progress", data: { id: "build" } });
	});
});

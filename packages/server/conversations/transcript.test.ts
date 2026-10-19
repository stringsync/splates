import { describe, expect, it } from "bun:test";
import type { Message } from "./state";
import { TRANSCRIPT_CHARS, transcriptOf } from "./transcript";

describe("transcriptOf", () => {
	const said = (role: Message["role"], parts: Message["parts"]): Message => ({
		role,
		parts,
		plan: null,
		at: null,
		until: null,
	});

	it("keeps each turn's words and a line per tool, without thoughts", () => {
		expect(
			transcriptOf([
				said("user", [{ type: "text", text: "Fix the upload" }]),
				said("agent", [
					{ type: "thought", text: "hmm", at: null },
					{ type: "text", text: "Looking." },
					{
						type: "tool",
						id: "t1",
						title: "Run tests",
						status: "failed",
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
					},
				]),
				said("agent", [{ type: "thought", text: "only thinking", at: null }]),
			]),
		).toBe(
			"## Person\n\nFix the upload\n\n## Agent\n\nLooking.\n\n- bun test (failed)",
		);
	});

	it("keeps only the end of a long conversation", () => {
		const long = "x".repeat(TRANSCRIPT_CHARS);
		const text = transcriptOf([
			said("user", [{ type: "text", text: "first" }]),
			said("agent", [{ type: "text", text: long }]),
		]);
		expect(text.startsWith("…\n\n")).toBe(true);
		expect(text).not.toContain("first");
		expect(text.endsWith(long)).toBe(true);
	});
});

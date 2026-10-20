import "./register-dom";
import { describe, expect, it } from "bun:test";
import { windowStart } from "./thread-messages";

describe("thread history window", () => {
	const messages = Array.from({ length: 45 }, (_, turn) => [
		{
			id: String(turn * 2),
			role: "user" as const,
			content: [{ type: "text" as const, text: `Prompt ${turn}` }],
		},
		{
			id: String(turn * 2 + 1),
			role: "assistant" as const,
			content: [{ type: "text" as const, text: `Reply ${turn}` }],
		},
	]).flat();
	it("starts with twenty whole turns and reveals twenty more at a time", () => {
		expect(windowStart(messages, null)).toBe(50);
		expect(windowStart(messages, null, undefined, 20)).toBe(10);
		expect(windowStart(messages, "10", undefined, 20)).toBe(0);
	});
	it("includes the prompt preceding an older unread reply", () => {
		expect(windowStart(messages, null, "21")).toBe(20);
	});
	it("keeps revealed history as more turns arrive", () => {
		expect(
			windowStart([...messages, { id: "90", role: "user", content: [] }], "50"),
		).toBe(50);
	});
	it("does not split turns at checkpoint lines", () => {
		const withLine = [
			...messages.slice(0, 60),
			{
				id: "checkpoint",
				role: "user" as const,
				content: [{ type: "text" as const, text: "[SPLATES CHECKPOINT]" }],
			},
			...messages.slice(60),
		];
		expect(windowStart(withLine, null)).toBe(50);
		expect(windowStart(withLine, null, "checkpoint")).toBe(50);
	});
	it("handles empty and short threads", () => {
		expect(windowStart([], null)).toBe(0);
		expect(windowStart(messages.slice(0, 4), null)).toBe(0);
	});
});

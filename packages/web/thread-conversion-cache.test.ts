import "./register-dom";
import { describe, expect, it } from "bun:test";
import type { Message } from "@stringsync/splates-server/conversations";
import { like } from "./thread-messages";

describe("message conversion cache", () => {
	const source = (): Message => ({
		role: "agent",
		parts: [{ type: "text", text: "Hello" }],
		at: null,
		until: null,
		plan: null,
	});
	it("retains settled conversions across visits and clock updates", () => {
		const message = source();
		const first = like(message, 0, "cached", true, null, 1);
		like(source(), 0, "other");
		expect(like(message, 0, "cached", true, null, 2)).toBe(first);
	});
	it("rebuilds changed sources and running or settled state", () => {
		const message = source();
		const first = like(message, 0, "changed", false, null, 1);
		expect(like(message, 0, "changed", false, null, 2)).not.toBe(first);
		expect(like(message, 0, "changed", true)).not.toBe(first);
		expect(
			like(
				{ ...message, parts: [{ type: "text", text: "New" }] },
				0,
				"changed",
			),
		).not.toBe(first);
	});
	it("bounds retained conversations to the five most recently visited", () => {
		const message = source();
		const first = like(message, 0, "evicted");
		Array.from({ length: 5 }, (_, i) => like(source(), 0, `visit-${i}`));
		expect(like(message, 0, "evicted")).not.toBe(first);
	});
});

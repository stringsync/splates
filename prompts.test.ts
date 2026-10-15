import { describe, expect, it } from "bun:test";
import { handoffToReference, leadingDirectives } from "./prompts";

describe("leadingDirectives", () => {
	it("splits the directives a text starts with from the rest", () => {
		expect(
			leadingDirectives("[ARBOR TODO #12]\n\n[ARBOR LANE 2] and keep it small"),
		).toEqual({
			directives: ["[ARBOR TODO #12]", "[ARBOR LANE 2]"],
			rest: "and keep it small",
		});
		expect(leadingDirectives("[ARBOR CHECKPOINT]")).toEqual({
			directives: ["[ARBOR CHECKPOINT]"],
			rest: "",
		});
	});

	it("reads a handoff the page asks for, naming its agent and any model", () => {
		const asked = handoffToReference({ agent: "codex", model: "gpt-5.5" });

		expect(asked).toBe("[ARBOR HANDOFF TO codex gpt-5.5]");
		expect(leadingDirectives(`${asked} for the styles`)).toEqual({
			directives: [asked],
			rest: "for the styles",
		});
		expect(handoffToReference({ agent: "claude" })).toBe(
			"[ARBOR HANDOFF TO claude]",
		);
	});

	it("finds none in a text that starts with anything else, or one half typed", () => {
		for (const text of [
			"see [ARBOR TODO #12]",
			"[ARBOR TODO #12",
			"[ARBOR TODO #12]and",
			"[arbor todo #12]",
		]) {
			expect(leadingDirectives(text)).toEqual({ directives: [], rest: text });
		}
	});
});

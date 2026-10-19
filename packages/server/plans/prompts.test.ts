import { describe, expect, it } from "bun:test";
import {
	directive,
	handoffToReference,
	leadingDirectives,
	MERGE,
} from "./prompts";

describe("leadingDirectives", () => {
	it("splits the directives a text starts with from the rest", () => {
		expect(
			leadingDirectives(
				"[SPLATES TASK #12]\n\n[SPLATES LANE 2] and keep it small",
			),
		).toEqual({
			directives: ["[SPLATES TASK #12]", "[SPLATES LANE 2]"],
			rest: "and keep it small",
		});
		expect(leadingDirectives("[SPLATES CHECKPOINT]")).toEqual({
			directives: ["[SPLATES CHECKPOINT]"],
			rest: "",
		});
	});

	it("reads a handoff the page asks for, naming its agent and any model", () => {
		const asked = handoffToReference({ agent: "codex", model: "gpt-5.5" });

		expect(asked).toBe("[SPLATES HANDOFF TO codex gpt-5.5]");
		expect(leadingDirectives(`${asked} for the styles`)).toEqual({
			directives: [asked],
			rest: "for the styles",
		});
		expect(handoffToReference({ agent: "claude" })).toBe(
			"[SPLATES HANDOFF TO claude]",
		);
	});

	it("finds none in a text that starts with anything else, or one half typed", () => {
		const texts = [
			"see [SPLATES TASK #12]",
			"[SPLATES TASK #12",
			"[SPLATES TASK #12]and",
			"[splates task #12]",
		];

		expect(texts.map(leadingDirectives)).toEqual(
			texts.map((text) => ({ directives: [], rest: text })),
		);
	});
});

describe("directive", () => {
	it("reads arbor's directive as splates's", () => {
		expect(directive(" [ARBOR MERGE] ")).toBe(MERGE);
	});

	it("reads a queued task's directive from before the rename as its task's", () => {
		expect(
			[
				"[SPLATES TODO #12]",
				"[SPLATES TODO DONE #12]",
				"[ARBOR TODO ADDED #12]",
				"[SPLATES TODO later]",
			].map(directive),
		).toEqual([
			"[SPLATES TASK #12]",
			"[SPLATES TASK DONE #12]",
			"[SPLATES TASK ADDED #12]",
			"[SPLATES TODO later]",
		]);
	});

	it("reads an arbor directive leading a text as splates's", () => {
		expect(leadingDirectives("[ARBOR TASK alpha] go on")).toEqual({
			directives: ["[SPLATES TASK alpha]"],
			rest: "go on",
		});
	});
});

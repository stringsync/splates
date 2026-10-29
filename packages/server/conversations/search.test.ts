import { describe, expect, it } from "bun:test";
import { said } from "./messages";
import { saidIn, wordsOf } from "./search";
import { blank } from "./state";

describe("conversation search", () => {
	it("finds each word in any message, with a line around its first", () => {
		const state = blank("c1", "fake", null, "now");
		state.messages = [
			said("Why does the Upload fail?", null),
			said(`${"x ".repeat(60)}on a 413 every time`, null),
		];
		expect(saidIn(state, wordsOf("  upload 413 nowhere "))).toEqual({
			upload: `Why does the Upload fail? ${"x ".repeat(17).trim()}…`,
			"413": `…${"x ".repeat(17)}on a 413 every time`,
		});
	});

	it("is null when none of the words are said", () => {
		const state = blank("c1", "fake", null, "now");
		state.messages = [said("Hello", null)];
		expect(saidIn(state, ["upload"])).toBeNull();
	});
});

import { describe, expect, it } from "bun:test";
// Set up the DOM before the card dependencies initialize their browser checks.
import "./testing-library";

const { sideOf } = await import("./before-after");

describe("sideOf", () => {
	it("keeps a label's words apart from its pictures, without leading punctuation", () => {
		const side = sideOf(
			"It fits.\n\n*Actual*, the real card:\n\n![shot](/tmp/shot.png)",
		);
		expect(side.words).toEqual(["It fits."]);
		expect(side.variants.actual).toEqual({
			pictures: ["![shot](/tmp/shot.png)"],
			words: ["The real card:"],
		});
	});

	it("gives a bare label the one paragraph after it, and then lets words go", () => {
		const side = sideOf("*Expected*\n\nThe sketch.\n\nChecked at 390px.");
		expect(side.variants.expected.words).toEqual(["The sketch."]);
		expect(side.words).toEqual(["Checked at 390px."]);
	});
});

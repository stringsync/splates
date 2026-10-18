import { describe, expect, it } from "bun:test";
import { questionNumber } from "./plan";

describe("questionNumber", () => {
	it.each(["9", "q9", "Q9", "9.", " q9: "])(
		"reads a number however it was typed: %p",
		(raw) => {
			expect(questionNumber(raw)).toBe("9");
		},
	);

	it("reads no number from anything else", () => {
		expect(questionNumber("nine")).toBeNull();
		expect(questionNumber("D9")).toBeNull();
	});
});

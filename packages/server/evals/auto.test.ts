import { describe, expect, it } from "bun:test";
import { fitsEvalBudget } from "./auto";

describe("fitsEvalBudget", () => {
	it("fits when spend plus the round's ceiling stays within the budget", () => {
		expect(fitsEvalBudget(10, 8, 2)).toBe(true);
		expect(fitsEvalBudget(10, 8.5, 2)).toBe(false);
	});

	it("never fits a round with no ceiling, or with no budget approved", () => {
		expect(fitsEvalBudget(10, 0, null)).toBe(false);
		expect(fitsEvalBudget(0, 0, 0)).toBe(false);
	});
});

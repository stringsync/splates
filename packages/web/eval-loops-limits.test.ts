import { describe, expect, test } from "bun:test";
import { scenarioPrompt } from "./eval-improve";
import { loopLimits } from "./eval-loops";

describe("loopLimits", () => {
	test("reads the budget and rounds of a loop directive", () => {
		expect(loopLimits(scenarioPrompt("a/b", { usd: 2.5, rounds: 4 }))).toEqual({
			usd: 2.5,
			rounds: 4,
		});
	});

	test("is null without a loop directive or limits", () => {
		expect(loopLimits("Budget: $5\nRounds: 2")).toBeNull();
		expect(loopLimits("[SPLATES EVAL LOOP x]")).toBeNull();
	});
});

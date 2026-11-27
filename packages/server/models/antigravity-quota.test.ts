import { describe, expect, it } from "bun:test";
import { antigravityLimitsForModel } from "./antigravity-quota";

const AT = "2026-11-26T12:00:00.000Z";
const LIMITS = [
	{ window: "Gemini Models · Weekly", used: 0.9, resets: null, at: AT },
	{ window: "Gemini Models · Five Hour", used: 0.95, resets: null, at: AT },
	{ window: "Claude and GPT models · Weekly", used: 0.1, resets: null, at: AT },
	{
		window: "Claude and GPT models · Five Hour",
		used: 0.2,
		resets: null,
		at: AT,
	},
];

describe("antigravityLimitsForModel", () => {
	it.each(["claude-opus-5-5", "claude-sonnet-5-5"])(
		"bounds %s by the Claude and GPT quota alone",
		(model) => {
			expect(
				antigravityLimitsForModel(LIMITS, model).map((each) => each.window),
			).toEqual([
				"Claude and GPT models · Five Hour",
				"Claude and GPT models · Weekly",
			]);
		},
	);

	it("bounds a Gemini model by the Gemini quota alone", () => {
		expect(
			antigravityLimitsForModel(LIMITS, "gemini-4-neon").map(
				(each) => each.window,
			),
		).toEqual(["Gemini Models · Five Hour", "Gemini Models · Weekly"]);
	});
});

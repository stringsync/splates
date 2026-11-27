import { describe, expect, it } from "bun:test";
import {
	antigravityGroupLabel,
	antigravityGroups,
	antigravityLimitsForModel,
} from "./antigravity-quota";

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

describe("antigravityGroups", () => {
	it("splits grouped windows by quota family with short labels", () => {
		expect(
			antigravityGroups(LIMITS).map((each) => ({
				group: each.group,
				label: each.label,
				windows: each.limits.map((limit) => limit.window),
			})),
		).toEqual([
			{
				group: "Gemini Models",
				label: "Gemini",
				windows: ["Gemini Models · Five Hour", "Gemini Models · Weekly"],
			},
			{
				group: "Claude and GPT models",
				label: "Claude & GPT",
				windows: [
					"Claude and GPT models · Five Hour",
					"Claude and GPT models · Weekly",
				],
			},
		]);
		expect(antigravityGroupLabel("Gemini Models")).toBe("Gemini");
		expect(antigravityGroupLabel("Claude and GPT models")).toBe("Claude & GPT");
	});
});

import { expect, it } from "bun:test";
import { antigravityModelLimits } from "./plan-limits";

it("shows only the selected model with its most-used thinking allowance", () => {
	const at = "2026-11-21T22:00:00Z";
	const row = { used: 0.2, at, resets: "2026-11-23T22:00:00Z" };
	expect(
		antigravityModelLimits(
			[
				{ ...row, window: "All Models · Gemini 3.8 Flash (Low)" },
				{ ...row, used: 0.8, window: "All Models · Gemini 3.8 Flash (High)" },
				{ ...row, used: 0.9, window: "All Models · Claude Opus 5.5 (High)" },
			],
			"gemini-3.8-flash",
		),
	).toEqual([{ ...row, used: 0.8, window: "Antigravity quota" }]);
	expect(
		antigravityModelLimits(
			[{ ...row, window: "All Models · Claude Opus 5.5 (High)" }],
			"gemini-3.8-flash",
		),
	).toEqual([]);
});

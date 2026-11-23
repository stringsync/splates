import { expect, it } from "bun:test";
import { antigravityModelLimits, antigravityPlanLimits } from "./plan-limits";

it("shows all grouped 5-hour and weekly windows on Billing, with 5-hour first per group", () => {
	const at = "2026-11-22T20:10:00Z";
	const stale = "2026-11-22T19:00:00Z";
	const limits = [
		{
			window: "All Models · Gemini 4 Neon",
			used: 0.5,
			resets: null,
			at: stale,
		},
		{
			window: "Gemini Models · Weekly",
			used: 0.2,
			resets: "2026-11-29T20:04:52Z",
			at,
		},
		{
			window: "Gemini Models · Five Hour",
			used: 0.4,
			resets: "2026-11-23T01:04:52Z",
			at,
		},
		{
			window: "Claude and GPT models · Weekly",
			used: 0.1,
			resets: "2026-11-29T20:07:23Z",
			at,
		},
		{
			window: "Claude and GPT models · Five Hour",
			used: 0,
			resets: "2026-11-23T01:07:23Z",
			at,
		},
	];
	expect(antigravityPlanLimits(limits).map((each) => each.window)).toEqual([
		"Gemini Models · Five Hour",
		"Gemini Models · Weekly",
		"Claude and GPT models · Five Hour",
		"Claude and GPT models · Weekly",
	]);
	expect(antigravityPlanLimits([])).toEqual([]);
});

it("shows only the selected model's group on New Conversation for grouped plans", () => {
	const at = "2026-11-22T20:10:00Z";
	const limits = [
		{
			window: "Gemini Models · Weekly",
			used: 0.2,
			resets: "2026-11-29T20:04:52Z",
			at,
		},
		{
			window: "Gemini Models · Five Hour",
			used: 0.4,
			resets: "2026-11-23T01:04:52Z",
			at,
		},
		{
			window: "Claude and GPT models · Weekly",
			used: 0.1,
			resets: "2026-11-29T20:07:23Z",
			at,
		},
		{
			window: "Claude and GPT models · Five Hour",
			used: 0.3,
			resets: "2026-11-23T01:07:23Z",
			at,
		},
	];
	expect(
		antigravityModelLimits(limits, "gemini-4-neon").map((each) => each.window),
	).toEqual(["Gemini Models · Five Hour", "Gemini Models · Weekly"]);
	expect(
		antigravityModelLimits(limits, "gemini-pro-orchestrator-neon").map(
			(each) => each.window,
		),
	).toEqual(["Gemini Models · Five Hour", "Gemini Models · Weekly"]);
	expect(
		antigravityModelLimits(limits, "claude-opus-5-5").map(
			(each) => each.window,
		),
	).toEqual([
		"Claude and GPT models · Five Hour",
		"Claude and GPT models · Weekly",
	]);
	expect(
		antigravityModelLimits(limits, "gpt-oss-120b-medium").map(
			(each) => each.window,
		),
	).toEqual([
		"Claude and GPT models · Five Hour",
		"Claude and GPT models · Weekly",
	]);
});

it("falls back to a single collapsed row for legacy Enterprise per-model limits", () => {
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
	expect(
		antigravityPlanLimits([
			{ ...row, window: "All Models · Gemini 4 Carbon (Medium)" },
			{ ...row, used: 0.35, window: "All Models · Gemini 4 Neon (High)" },
		]),
	).toEqual([{ ...row, used: 0.35, window: "Antigravity quota" }]);
});

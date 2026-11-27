import { describe, expect, it } from "bun:test";
import { reserveHold } from "./reserve";
import type { AutopickRules } from "./rules";

const rules = {
	lineups: [{ id: "a", picks: [{ agent: "claude" }, { agent: "codex" }] }],
} as unknown as AutopickRules;
const now = new Date("2026-11-23T12:00:00Z");
const later = "2026-11-23T15:00:00Z";
const base = {
	reserve: 0.25,
	named: undefined,
	rules,
	runnable: ["claude", "codex"],
	now,
};
const window = (used: number, resets: string | null = later) => ({
	window: "five_hour",
	used,
	resets,
	at: null,
});

describe("reserveHold", () => {
	it("holds when every agent has less than the reserve left", () => {
		const hold = reserveHold({
			...base,
			limits: { claude: [window(0.9)], codex: [window(0.8)] },
		});
		expect(hold?.agents.map((each) => each.agent)).toEqual(["claude", "codex"]);
		expect(hold?.frees).toBe(later);
	});

	it("starts when one agent still has room", () => {
		expect(
			reserveHold({
				...base,
				limits: { claude: [window(0.9)], codex: [window(0.2)] },
			}),
		).toBeNull();
	});

	it("treats an agent with no window as having room, and a reset window as full", () => {
		expect(
			reserveHold({ ...base, limits: { claude: [window(0.9)] } }),
		).toBeNull();
		expect(
			reserveHold({
				...base,
				limits: {
					claude: [window(0.9, "2026-11-23T11:00:00Z")],
					codex: [window(0.9)],
				},
			}),
		).toBeNull();
	});

	it("looks only at the agent a task names", () => {
		expect(
			reserveHold({
				...base,
				named: { agent: "claude" },
				limits: { claude: [window(0.9)], codex: [window(0.1)] },
			})?.agents,
		).toHaveLength(1);
	});

	it("holds nothing with a zero reserve", () => {
		expect(
			reserveHold({ ...base, reserve: 0, limits: { claude: [window(1)] } }),
		).toBeNull();
	});

	it("evaluates Antigravity's Gemini and Claude & GPT quotas independently", () => {
		const agyLimits = [
			{
				window: "Gemini Models · Five Hour",
				used: 0.95,
				resets: later,
				at: null,
			},
			{
				window: "Claude and GPT models · Five Hour",
				used: 0.1,
				resets: later,
				at: null,
			},
		];
		const agyRules = {
			lineups: [
				{
					id: "a",
					picks: [
						{ agent: "antigravity", model: "gemini-4-neon" },
						{ agent: "antigravity", model: "claude-opus-5-5" },
					],
				},
			],
		} as unknown as AutopickRules;

		// Named Claude pick on Antigravity is not held when only Gemini is low.
		expect(
			reserveHold({
				...base,
				named: { agent: "antigravity", model: "claude-opus-5-5" },
				runnable: ["antigravity"],
				limits: { antigravity: agyLimits },
			}),
		).toBeNull();

		// Named Gemini pick on Antigravity is held when Gemini is low.
		expect(
			reserveHold({
				...base,
				named: { agent: "antigravity", model: "gemini-4-neon" },
				runnable: ["antigravity"],
				limits: { antigravity: agyLimits },
			})?.agents,
		).toEqual([
			{
				agent: "antigravity",
				window: "Gemini Models · Five Hour",
				left: expect.closeTo(0.05, 5),
				resets: later,
			},
		]);

		// Auto-pick lineup with both Antigravity quotas starts when Claude & GPT has room.
		expect(
			reserveHold({
				...base,
				rules: agyRules,
				runnable: ["antigravity"],
				limits: { antigravity: agyLimits },
			}),
		).toBeNull();

		// Auto-pick lineup holds only when both Antigravity quotas are below reserve.
		const bothLow = [
			{
				window: "Gemini Models · Five Hour",
				used: 0.95,
				resets: later,
				at: null,
			},
			{
				window: "Claude and GPT models · Five Hour",
				used: 0.9,
				resets: later,
				at: null,
			},
		];
		expect(
			reserveHold({
				...base,
				rules: agyRules,
				runnable: ["antigravity"],
				limits: { antigravity: bothLow },
			})?.agents.map((each) => each.window),
		).toEqual([
			"Gemini Models · Five Hour",
			"Claude and GPT models · Five Hour",
		]);
	});
});

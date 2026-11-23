import { describe, expect, it } from "bun:test";
import type { Limit } from "@splates/server/conversations";
import type { AgentChoice } from "./agent-choice";
import { quotaByAgent } from "./plan-limits";

const HOUR = 3_600_000;
const now = Date.parse("2026-11-22T15:00:00.000Z");
const at = (offset: number) => new Date(now + offset).toISOString();

const limit = (window: string, used: number, resetsIn: number): Limit => ({
	window,
	used,
	resets: at(resetsIn),
	at: at(0),
});

describe("quota per agent, grouped by schedule", () => {
	const agent = (id: string, name: string, limits: Limit[]): AgentChoice => ({
		id,
		name,
		settings: [],
		limits,
	});

	it("names each agent's shortest window for the agent, the fullest of several, groups agents by schedule and leaves out an agent with none", () => {
		const groups = quotaByAgent(
			[
				agent("claude", "Claude", [
					limit("five_hour", 0.34, 2 * HOUR),
					limit("seven_day", 0.9, 24 * HOUR),
				]),
				agent("codex", "Codex", [limit("10080_minutes", 0.5, 48 * HOUR)]),
				agent("antigravity", "Antigravity", [
					limit("Gemini · Five Hour", 0.2, HOUR),
					limit("Claude · Five Hour", 0.96, HOUR),
				]),
				agent("gemini", "Gemini", []),
			],
			[],
		);
		expect(
			groups.map((group) => [
				group.title,
				group.limits.map((each) => [each.window, each.used]),
			]),
		).toEqual([
			[
				"5-hour quota",
				[
					["Claude", 0.34],
					["Antigravity", 0.96],
				],
			],
			["Weekly quota", [["Codex", 0.5]]],
		]);
	});
});

import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";

describe("decide", () => {
	it("takes the first rule matching the likeliest kind and difficulty, saying why", () => {
		expect(decide({ ...BASE, classification: MECHANICAL_LIGHT })).toEqual({
			pick: { agent: "codex", model: "gpt-6-luna", effort: "low" },
			rule: 1,
			kind: "mechanical",
			difficulty: "easy",
			reasons: [
				"6 Luna, low effort",
				"judged: Mechanical 72%, Easy 64%",
				"rule 2: Mechanical, Easy",
			],
		});
	});

	it("matches a rule's * to any difficulty", () => {
		expect(decide({ ...BASE, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			rule: 5,
			kind: "design",
			difficulty: "medium",
		});
	});

	it("takes a task for no kind when the judge is not sure enough, so only * matches it", () => {
		const unsure: Classification = {
			kinds: {
				lookup: 0.1,
				mechanical: 0.2,
				bugfix: 0.3,
				design: 0.4,
				open: 0.1,
			},
			difficulty: { easy: 0.1, medium: 0.2, hard: 0.8 },
		};
		expect(decide({ ...BASE, classification: unsure })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			rule: 9,
			kind: null,
			difficulty: "hard",
			reasons: [
				"Opus 5.5, high effort",
				"judged: unsure (Design 40%), Hard 80%",
				"rule 10: any kind, Hard",
			],
		});
	});

	it("follows the person's threshold", () => {
		const strict: AutoPickRules = { ...DEFAULT_RULES, threshold: 0.75 };
		expect(
			decide({ ...BASE, rules: strict, classification: MECHANICAL_LIGHT }),
		).toMatchObject({ rule: 10, kind: null, difficulty: null });
	});

	it("lets an earlier rule win over a more specific one below it", () => {
		const rules: AutoPickRules = {
			format: 1,
			threshold: 0.5,
			rules: [
				{ kind: "*", difficulty: "easy", picks: [{ agent: "codex" }] },
				{
					kind: "mechanical",
					difficulty: "easy",
					picks: [{ agent: "claude" }],
				},
				{ kind: "*", difficulty: "*", picks: [{ agent: "claude" }] },
			],
		};
		expect(
			decide({ ...BASE, rules, classification: MECHANICAL_LIGHT }),
		).toMatchObject({
			pick: { agent: "codex" },
			rule: 0,
			reasons: [
				"Codex on its default model",
				expect.any(String),
				"rule 1: any kind, Easy",
			],
		});
	});

	it("passes over an agent nearly out of plan for the next pick", () => {
		const limits = {
			claude: [
				{ window: "five_hour", used: 0.96, resets: LATER, at: null },
				{ window: "seven_day", used: 0.99, resets: EARLIER, at: null },
			],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN })).toMatchObject({
			pick: { agent: "codex", model: "gpt-6-astra", effort: "high" },
			reasons: [
				"6 Astra, high effort",
				expect.any(String),
				expect.any(String),
				"passed over Claude: 96% of five_hour used",
			],
		});
	});

	it("keeps an agent whose spent window has already reset", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.99, resets: EARLIER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN }).pick).toEqual({
			agent: "claude",
			model: "opus",
			effort: "high",
		});
	});

	it("takes the least used pick when every one is spent", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.98, resets: LATER, at: null }],
			codex: [{ window: "primary", used: 0.96, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN })).toMatchObject({
			pick: { agent: "codex", model: "gpt-6-astra" },
			reasons: [
				"6 Astra, high effort",
				expect.any(String),
				expect.any(String),
				"every pick is past 95% of a plan, so the least used: Codex, 96% of primary used",
			],
		});
	});

	it("passes over a pick whose agent is not on the roster", () => {
		const rules: AutoPickRules = {
			format: 1,
			threshold: 0.5,
			rules: [
				{
					kind: "*",
					difficulty: "*",
					picks: [{ agent: "ghost" }, { agent: "claude", model: "Sonnet 5.5" }],
				},
			],
		};
		expect(decide({ ...BASE, rules, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "sonnet" },
			reasons: [
				"Sonnet 5.5",
				expect.any(String),
				"rule 1: any kind, any difficulty",
				"passed over ghost: not on the roster",
			],
		});
	});

	it("passes over a pick whose agent splates can't run here", () => {
		expect(
			decide({ ...BASE, runnable: ["codex"], classification: DESIGN }),
		).toMatchObject({
			pick: { agent: "codex", model: "gpt-6-astra" },
			reasons: [
				expect.any(String),
				expect.any(String),
				"rule 6: Design, any difficulty",
				"passed over Claude: can't run here",
			],
		});
	});

	it("falls back on the first roster agent that runs when no pick of the rule does", () => {
		const rules: AutoPickRules = {
			format: 1,
			threshold: 0.5,
			rules: [{ kind: "*", difficulty: "*", picks: [{ agent: "claude" }] }],
		};
		expect(
			decide({ ...BASE, rules, runnable: ["codex"], classification: DESIGN }),
		).toMatchObject({
			pick: { agent: "codex" },
			reasons: expect.arrayContaining([
				"passed over Claude: can't run here",
				"no pick of rule 1 can run here, so Codex on its default",
			]),
		});
	});

	it("drops an effort the agent does not offer, keeping the pick", () => {
		const offered = { claude: [THOUGHT_LEVEL] };
		expect(decide({ ...BASE, offered, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "opus" },
			reasons: [
				"Opus 5.5",
				expect.any(String),
				expect.any(String),
				"Claude offers no high thinking, so its own",
			],
		});
		expect(
			decide({ ...BASE, offered, classification: MECHANICAL_LIGHT }).pick,
		).toEqual({ agent: "codex", model: "gpt-6-luna", effort: "low" });
	});

	it("falls back to Claude for mechanical work when Codex's plan is spent", () => {
		const limits = {
			codex: [{ window: "five_hour", used: 0.97, resets: LATER, at: null }],
		};
		expect(
			decide({ ...BASE, limits, classification: MECHANICAL_LIGHT }).pick,
		).toEqual({ agent: "claude", model: "haiku", effort: "low" });
	});
});

const NOW = new Date("2026-10-19T12:00:00Z");
const LATER = "2026-10-19T15:00:00Z";
const EARLIER = "2026-10-19T09:00:00Z";

/** A task the judge takes for mechanical and easy work. */
const MECHANICAL_LIGHT: Classification = {
	kinds: { lookup: 0.1, mechanical: 0.72, bugfix: 0.2, design: 0.1, open: 0.1 },
	difficulty: { easy: 0.64, medium: 0.3, hard: 0.05 },
};

/** A design task the judge takes for medium work. */
const DESIGN: Classification = {
	kinds: { lookup: 0.1, mechanical: 0.1, bugfix: 0.2, design: 0.9, open: 0.3 },
	difficulty: { easy: 0.1, medium: 0.8, hard: 0.3 },
};

const BASE = {
	rules: DEFAULT_RULES,
	agents: DEFAULT_AGENTS,
	runnable: DEFAULT_AGENTS.map((each) => each.id),
	limits: {},
	offered: {},
	now: NOW,
};

const THOUGHT_LEVEL: Setting = {
	id: "effort",
	name: "Effort",
	type: "select",
	category: "thought_level",
	current: "medium",
	options: [
		{ value: "low", name: "Low", description: null },
		{ value: "medium", name: "Medium", description: null },
	],
};

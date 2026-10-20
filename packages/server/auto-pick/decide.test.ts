import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";

describe("decide", () => {
	it("takes the first rule matching the likeliest kind and depth, saying why", () => {
		expect(decide({ ...BASE, classification: SHALLOW })).toEqual({
			pick: { agent: "claude", model: "sonnet", effort: "low" },
			rule: 0,
			kind: "bugfix",
			depth: "shallow",
			reasons: [
				"Sonnet 5.5, low effort",
				"judged: Bugfix 72%, Shallow 64%",
				"rule 1: any kind, Shallow",
			],
		});
	});

	it("matches a rule's * to any depth", () => {
		expect(decide({ ...BASE, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			rule: 2,
			kind: "design",
			depth: "deep",
		});
	});

	it("takes a task for no kind when the judge is not sure enough, so only * matches it", () => {
		const unsure: Classification = {
			kinds: {
				bugfix: 0.3,
				design: 0.4,
				open: 0.1,
			},
			depth: { shallow: 0.1, moderate: 0.2, deep: 0.8 },
		};
		expect(decide({ ...BASE, classification: unsure })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			rule: 2,
			kind: null,
			depth: "deep",
			reasons: [
				"Opus 5.5, high effort",
				"judged: unsure (Design 40%), Deep 80%",
				"rule 3: any kind, Deep",
			],
		});
	});

	it("follows the person's threshold", () => {
		const strict: AutoPickRules = { ...DEFAULT_RULES, threshold: 0.75 };
		expect(
			decide({ ...BASE, rules: strict, classification: SHALLOW }),
		).toMatchObject({ rule: 3, kind: null, depth: null });
	});

	it("lets an earlier rule win over a more specific one below it", () => {
		const rules: AutoPickRules = {
			format: 2,
			threshold: 0.5,
			rules: [
				{ kind: "*", depth: "shallow", picks: [{ agent: "codex" }] },
				{
					kind: "bugfix",
					depth: "shallow",
					picks: [{ agent: "claude" }],
				},
				{ kind: "*", depth: "*", picks: [{ agent: "claude" }] },
			],
		};
		expect(decide({ ...BASE, rules, classification: SHALLOW })).toMatchObject({
			pick: { agent: "codex" },
			rule: 0,
			reasons: [
				"Codex on its default model",
				expect.any(String),
				"rule 1: any kind, Shallow",
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

	it("passes over an OpenCode model whose Go cap was refused, not its other models", () => {
		const opencode = {
			id: "opencode",
			name: "OpenCode",
			argv: ["opencode", "acp"],
			models: ["a", "b"].map((id) => ({
				id,
				name: id,
				strengths: "",
				cost: "unknown",
			})),
		};
		const rules: AutoPickRules = {
			...DEFAULT_RULES,
			rules: [
				{
					kind: "*",
					depth: "*",
					picks: [
						{ agent: "opencode", model: "a" },
						{ agent: "opencode", model: "b" },
					],
				},
			],
		};
		const limits = {
			opencode: [{ window: "cap:a", used: 1, resets: LATER, at: null }],
		};
		expect(
			decide({
				...BASE,
				agents: [opencode],
				runnable: ["opencode"],
				rules,
				limits,
				classification: DESIGN,
			}).pick,
		).toEqual({ agent: "opencode", model: "b" });
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

	it("passes over a pick whose agent uses a window faster than it goes by", () => {
		// Two of five hours gone, so 40% of the window: 60% used is ahead.
		const limits = {
			claude: [{ window: "five_hour", used: 0.6, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN })).toMatchObject({
			pick: { agent: "codex", model: "gpt-6-astra", effort: "high" },
			reasons: [
				"6 Astra, high effort",
				expect.any(String),
				expect.any(String),
				"passed over Claude: 60% of five_hour used, 40% of it gone",
			],
		});
	});

	it("keeps a pick within its slack of pace", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.45, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN }).pick).toEqual({
			agent: "claude",
			model: "opus",
			effort: "high",
		});
	});

	it("judges pace by when the use was read", () => {
		// Read at the window's start, 30% used is far ahead, though 40% of it is gone now.
		const limits = {
			claude: [
				{ window: "five_hour", used: 0.3, resets: LATER, at: WINDOW_START },
			],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN }).pick.agent).toBe(
			"codex",
		);
	});

	it("judges a week's window and a window named in minutes", () => {
		const week = {
			claude: [
				{ window: "seven_day_opus", used: 0.5, resets: IN_SIX_DAYS, at: null },
			],
		};
		expect(
			decide({ ...BASE, limits: week, classification: DESIGN }).pick.agent,
		).toBe("codex");
		const minutes = {
			claude: [{ window: "300_minutes", used: 0.6, resets: LATER, at: null }],
		};
		expect(
			decide({ ...BASE, limits: minutes, classification: SHALLOW }).pick.agent,
		).toBe("codex");
	});

	it("does not judge the pace of a window whose length its name does not give", () => {
		const limits = {
			claude: [{ window: "primary", used: 0.9, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN }).pick.agent).toBe(
			"claude",
		);
	});

	it("takes the first pick with plan left when every one is ahead of pace", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.6, resets: LATER, at: null }],
			codex: [{ window: "five_hour", used: 0.7, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "opus" },
			reasons: [
				"Opus 5.5, high effort",
				expect.any(String),
				expect.any(String),
				"every pick with plan left is ahead of pace, so the first: Claude, 60% of five_hour used, 40% of it gone",
			],
		});
	});

	it("follows the person's pace", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.6, resets: LATER, at: null }],
		};
		const off: AutoPickRules = {
			...DEFAULT_RULES,
			pace: { on: false, slack: 0.1, spent: 0.95 },
		};
		expect(
			decide({ ...BASE, rules: off, limits, classification: DESIGN }).pick
				.agent,
		).toBe("claude");
		const loose: AutoPickRules = {
			...DEFAULT_RULES,
			pace: { on: true, slack: 0.25, spent: 0.95 },
		};
		expect(
			decide({ ...BASE, rules: loose, limits, classification: DESIGN }).pick
				.agent,
		).toBe("claude");
		const capped: AutoPickRules = {
			...DEFAULT_RULES,
			pace: { on: false, slack: 0.1, spent: 0.5 },
		};
		expect(
			decide({ ...BASE, rules: capped, limits, classification: DESIGN }),
		).toMatchObject({
			pick: { agent: "codex" },
			reasons: expect.arrayContaining([
				"passed over Claude: 60% of five_hour used",
			]),
		});
	});

	it("paces a mapping that names no pace as the defaults do", () => {
		const { pace: _, ...without } = DEFAULT_RULES;
		const limits = {
			claude: [{ window: "five_hour", used: 0.6, resets: LATER, at: null }],
		};
		expect(
			decide({ ...BASE, rules: without, limits, classification: DESIGN }).pick
				.agent,
		).toBe("codex");
	});

	it("passes over a pick whose agent is not on the roster", () => {
		const rules: AutoPickRules = {
			format: 2,
			threshold: 0.5,
			rules: [
				{
					kind: "*",
					depth: "*",
					picks: [{ agent: "ghost" }, { agent: "claude", model: "Sonnet 5.5" }],
				},
			],
		};
		expect(decide({ ...BASE, rules, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "sonnet" },
			reasons: [
				"Sonnet 5.5",
				expect.any(String),
				"rule 1: any kind, any depth",
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
				"rule 3: any kind, Deep",
				"passed over Claude: can't run here",
			],
		});
	});

	it("passes over a pick that can't see the task's images, by what models.dev lists or the agent said", () => {
		const blind = {
			"anthropic/claude-opus-5-5": { ...PRICE, inputs: ["text"] },
		};
		expect(
			decide({
				...BASE,
				images: true,
				catalog: blind,
				classification: DESIGN,
			}),
		).toMatchObject({
			pick: { agent: "codex", model: "gpt-6-astra" },
			reasons: expect.arrayContaining([
				"passed over Claude: can't see images",
				"Codex stays a pick: image support unknown",
			]),
		});
		expect(
			decide({
				...BASE,
				images: true,
				sights: { claude: true, codex: false },
				classification: DESIGN,
			}),
		).toMatchObject({
			pick: { agent: "claude", model: "opus" },
			reasons: expect.arrayContaining([
				"Claude stays a pick: image support unknown",
				"passed over Codex: can't see images",
			]),
		});
	});

	it("takes the rule's first pick when none of its picks can see the images", () => {
		expect(
			decide({
				...BASE,
				images: true,
				sights: { claude: false, codex: false },
				classification: DESIGN,
			}),
		).toMatchObject({
			pick: { agent: "claude", model: "opus" },
			reasons: expect.arrayContaining([
				"none of rule 3's picks can see images, so the first: Claude",
			]),
		});
	});

	it("filters nothing without an image", () => {
		expect(
			decide({
				...BASE,
				sights: { claude: false },
				classification: DESIGN,
			}),
		).toMatchObject({ pick: { agent: "claude", model: "opus" } });
	});

	it("falls back on the first roster agent that runs when no pick of the rule does", () => {
		const rules: AutoPickRules = {
			format: 2,
			threshold: 0.5,
			rules: [{ kind: "*", depth: "*", picks: [{ agent: "claude" }] }],
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
		expect(decide({ ...BASE, offered, classification: SHALLOW }).pick).toEqual({
			agent: "claude",
			model: "sonnet",
			effort: "low",
		});
	});

	it("falls back to Codex for shallow work when Claude's plan is spent", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.97, resets: LATER, at: null }],
		};
		expect(decide({ ...BASE, limits, classification: SHALLOW }).pick).toEqual({
			agent: "codex",
			model: "gpt-6.1-sol",
			effort: "low",
		});
	});
});

const NOW = new Date("2026-10-19T12:00:00Z");
const LATER = "2026-10-19T15:00:00Z";
const EARLIER = "2026-10-19T09:00:00Z";
const WINDOW_START = "2026-10-19T10:00:00Z";
const IN_SIX_DAYS = "2026-10-25T12:00:00Z";

/** A task the judge takes for shallow bugfix work. */
const SHALLOW: Classification = {
	kinds: { bugfix: 0.72, design: 0.1, open: 0.1 },
	depth: { shallow: 0.64, moderate: 0.3, deep: 0.05 },
};

/** A design task the judge takes for deep work. */
const DESIGN: Classification = {
	kinds: { bugfix: 0.72, design: 0.9, open: 0.3 },
	depth: { shallow: 0.1, moderate: 0.3, deep: 0.8 },
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

it("records context in reasons without changing the matched rule or pick", () => {
	const before = decide({ ...BASE, classification: DESIGN });
	const after = decide({
		...BASE,
		classification: {
			...DESIGN,
			breadth: { spot: 0.1, module: 0.2, system: 0.9 },
			clarity: { settled: 0.1, unresolved: 0.9 },
			stakes: { routine: 0.1, sensitive: 0.9 },
			verification: { automated: 0.1, visual: 0.9 },
		},
	});
	expect(after.pick).toEqual(before.pick);
	expect(after.rule).toBe(before.rule);
	expect(after.reasons).toEqual([
		...before.reasons,
		"breadth: One spot 10%, One module 20%, Across modules 90%",
		"clarity: Calls settled 10%, Calls unresolved 90%",
		"stakes: Routine 10%, Sensitive 90%",
		"verification: Automated 10%, Needs eyes 90%",
	]);
});

const PRICE = {
	input: 1,
	output: 1,
	cacheRead: 1,
	cacheWrite: 1,
	tiers: [],
};

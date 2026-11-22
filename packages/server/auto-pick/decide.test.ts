import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import { routedTo, withCell } from "./testing";

describe("decide", () => {
	const gemini4 = ["carbon", "neon", "hydrogen", "argon"].map(
		(name) => `gemini-4-${name}`,
	);
	const offerings = (ids: string[]): Setting[] => [
		{
			id: "model",
			name: "Model",
			type: "select",
			category: "model",
			current: ids[0] ?? "",
			options: ids.map((value) => ({ value, name: value, description: null })),
		},
	];

	it.each(gemini4)("selects offered Antigravity model %s", (model) => {
		const rules = routedTo([{ agent: "antigravity", model, effort: "low" }]);
		const offered = { antigravity: [...offerings([model]), THOUGHT_LEVEL] };
		expect(
			decide({ ...BASE, rules, offered, classification: DESIGN }).pick,
		).toEqual({ agent: "antigravity", model, effort: "low" });
	});

	it("passes over Gemini 4 for Flash on a personal account", () => {
		const rules = routedTo(
			[...gemini4, "gemini-3.8-flash"].map((model) => ({
				agent: "antigravity",
				model,
			})),
		);
		const offered = { antigravity: offerings(["gemini-3.8-flash"]) };
		const result = decide({ ...BASE, rules, offered, classification: DESIGN });
		expect(result.pick).toEqual({
			agent: "antigravity",
			model: "gemini-3.8-flash",
		});
		expect(result.reasons).toEqual(
			expect.arrayContaining(
				gemini4.map(
					(model) =>
						`passed over Antigravity: model '${model}' is not offered by this account`,
				),
			),
		);
	});

	it("uses an agent default when every explicit model is unavailable", () => {
		const rules = routedTo([
			{ agent: "antigravity", model: "gemini-4-carbon" },
		]);
		const offered = { antigravity: offerings([]) };
		expect(
			decide({
				...BASE,
				rules,
				offered,
				runnable: ["antigravity"],
				classification: DESIGN,
			}).pick,
		).toEqual({ agent: "antigravity" });
	});

	it.each(["uncached", "no selector"])(
		"keeps model picks with %s offerings",
		(state) => {
			const rules = routedTo([
				{ agent: "antigravity", model: "gemini-4-carbon" },
			]);
			const offered: Record<string, Setting[]> =
				state === "uncached" ? {} : { antigravity: [THOUGHT_LEVEL] };
			expect(
				decide({ ...BASE, rules, offered, classification: DESIGN }).pick,
			).toEqual({ agent: "antigravity", model: "gemini-4-carbon" });
		},
	);

	it("takes the lineup of the likeliest kind and depth, saying why", () => {
		expect(decide({ ...BASE, classification: SHALLOW })).toEqual({
			pick: { agent: "claude", model: "sonnet", effort: "low" },
			lineup: "quick",
			kind: "bugfix",
			depth: "shallow",
			reasons: [
				"Sonnet 5.5, low effort",
				"judged: Bugfix 72%, Shallow 64%",
				"route: Bugfix · Shallow → Quick",
			],
		});
	});

	it("routes deep design work to Opus", () => {
		expect(decide({ ...BASE, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			lineup: "careful",
			kind: "design",
			depth: "deep",
		});
	});

	it("starts a deep bugfix on Opus", () => {
		const bugfix: Classification = {
			kinds: { bugfix: 0.9, design: 0.1, open: 0.1, devops: 0.1 },
			depth: { shallow: 0.05, moderate: 0.1, deep: 0.85 },
		};
		expect(decide({ ...BASE, classification: bugfix })).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			lineup: "careful",
			kind: "bugfix",
			depth: "deep",
		});
	});

	it("takes a task for an unsure kind when the judge is not sure enough", () => {
		const unsure: Classification = {
			kinds: {
				bugfix: 0.3,
				design: 0.4,
				open: 0.1,
				devops: 0.1,
			},
			depth: { shallow: 0.1, moderate: 0.2, deep: 0.8 },
		};
		expect(decide({ ...BASE, classification: unsure })).toMatchObject({
			pick: { agent: "kimi", model: "kimi-code/k3.1-pro", effort: "max" },
			lineup: "hardest",
			kind: null,
			depth: "deep",
			reasons: [
				"K3.1 Pro, max effort",
				"judged: unsure (Design 40%), Deep 80%",
				"route: Unsure · Deep → Hardest",
			],
		});
	});

	it("follows the person's threshold", () => {
		const strict: AutoPickRules = { ...DEFAULT_RULES, threshold: 0.75 };
		expect(
			decide({ ...BASE, rules: strict, classification: SHALLOW }),
		).toMatchObject({ lineup: "standard", kind: null, depth: null });
	});

	it("takes only its own cell's lineup, not a neighbor's", () => {
		const rules = withCell(
			withCell(routedTo([{ agent: "claude" }]), "unsure", "shallow", "Near", [
				{ agent: "kimi" },
			]),
			"bugfix",
			"shallow",
			"Mine",
			[{ agent: "codex" }],
		);
		expect(decide({ ...BASE, rules, classification: SHALLOW })).toMatchObject({
			pick: { agent: "codex" },
			lineup: "mine",
			reasons: [
				"Codex on its default model",
				expect.any(String),
				"route: Bugfix · Shallow → Mine",
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
			pick: { agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			reasons: [
				"K3.1 Pro, high effort",
				expect.any(String),
				expect.any(String),
				"passed over Claude: 96% of five_hour used",
			],
		});
	});

	it.each(["five_hour", "seven_day", "month"])(
		"passes over Kimi when its %s plan window is spent",
		(window) => {
			const rules = routedTo([
				{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
				{ agent: "claude", model: "opus", effort: "high" },
			]);
			const limits = {
				kimi: [{ window, used: 0.96, resets: LATER, at: null }],
			};
			expect(
				decide({ ...BASE, rules, limits, classification: DESIGN }),
			).toMatchObject({
				pick: { agent: "claude", model: "opus", effort: "high" },
				reasons: [
					"Opus 5.5, high effort",
					expect.any(String),
					expect.any(String),
					`passed over Kimi: 96% of ${window} used`,
				],
			});
		},
	);

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
		const rules = routedTo([
			{ agent: "opencode", model: "a" },
			{ agent: "opencode", model: "b" },
		]);
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
			kimi: [{ window: "month", used: 0.97, resets: LATER, at: null }],
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
			pick: { agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			reasons: [
				"K3.1 Pro, high effort",
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
			"kimi",
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
		).toBe("kimi");
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
			kimi: [{ window: "five_hour", used: 0.8, resets: LATER, at: null }],
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
			pick: { agent: "kimi" },
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
		).toBe("kimi");
	});

	it("passes over a pick whose agent is not on the roster", () => {
		const rules = routedTo([
			{ agent: "ghost" },
			{ agent: "claude", model: "Sonnet 5.5" },
		]);
		expect(decide({ ...BASE, rules, classification: DESIGN })).toMatchObject({
			pick: { agent: "claude", model: "sonnet" },
			reasons: [
				"Sonnet 5.5",
				expect.any(String),
				"route: Design · Deep → All",
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
				"route: Design · Deep → Careful",
				"passed over Claude: can't run here",
				"passed over Kimi: can't run here",
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
			pick: { agent: "kimi", model: "kimi-code/k3.1-pro" },
			reasons: expect.arrayContaining([
				"passed over Claude: can't see images",
				"Kimi stays a pick: image support unknown",
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

	it("takes the lineup's first pick when none of its picks can see the images", () => {
		expect(
			decide({
				...BASE,
				images: true,
				sights: { claude: false, codex: false, kimi: false },
				classification: DESIGN,
			}),
		).toMatchObject({
			pick: { agent: "claude", model: "opus" },
			reasons: expect.arrayContaining([
				"none of Careful's picks can see images, so the first: Claude",
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

	it("falls back on the first roster agent that runs when no pick of the lineup does", () => {
		const rules = routedTo([{ agent: "claude" }]);
		expect(
			decide({ ...BASE, rules, runnable: ["codex"], classification: DESIGN }),
		).toMatchObject({
			pick: { agent: "codex" },
			reasons: expect.arrayContaining([
				"passed over Claude: can't run here",
				"no pick of All can run here, so Codex on its default",
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

	it("falls back to Kimi for deep work alone when Claude and Codex are spent", () => {
		const limits = {
			claude: [{ window: "five_hour", used: 0.98, resets: LATER, at: null }],
			codex: [{ window: "five_hour", used: 0.97, resets: LATER, at: null }],
		};
		expect(
			decide({ ...BASE, limits, classification: SHALLOW }).pick.agent,
		).not.toBe("kimi");
		expect(decide({ ...BASE, limits, classification: DESIGN }).pick).toEqual({
			agent: "kimi",
			model: "kimi-code/k3.1-pro",
			effort: "high",
		});
	});

	it("never gives devops work to Codex, at any depth", () => {
		const shallow = decide({
			...BASE,
			classification: {
				kinds: { bugfix: 0.1, design: 0.1, open: 0.1, devops: 0.9 },
				depth: { shallow: 0.9, moderate: 0.05, deep: 0.05 },
			},
		});
		expect(shallow).toMatchObject({ kind: "devops", lineup: "infra" });
		expect(DEFAULT_RULES.routes.devops).toEqual({
			unsure: "infra",
			shallow: "infra",
			moderate: "infra",
			deep: "infra",
		});
		expect(
			DEFAULT_RULES.lineups.find((each) => each.id === "infra"),
		).toMatchObject({
			picks: [
				{ agent: "claude", model: "sonnet", effort: "medium" },
				{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "high" },
			],
		});
	});

	it("never picks K3.1 Pro highspeed by default", () => {
		const models = DEFAULT_RULES.lineups.flatMap((each) =>
			each.picks.map((pick) => pick.model),
		);
		expect(models).not.toContain("kimi-code/k3.1-pro-highspeed");
	});
});

const NOW = new Date("2026-10-19T12:00:00Z");
const LATER = "2026-10-19T15:00:00Z";
const EARLIER = "2026-10-19T09:00:00Z";
const WINDOW_START = "2026-10-19T10:00:00Z";
const IN_SIX_DAYS = "2026-10-25T12:00:00Z";

/** A task the judge takes for shallow bugfix work. */
const SHALLOW: Classification = {
	kinds: { bugfix: 0.72, design: 0.1, open: 0.1, devops: 0.1 },
	depth: { shallow: 0.64, moderate: 0.3, deep: 0.05 },
};

/** A design task the judge takes for deep work. */
const DESIGN: Classification = {
	kinds: { bugfix: 0.72, design: 0.9, open: 0.3, devops: 0.1 },
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

it("records context in reasons without changing the lineup or pick", () => {
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
	expect(after.lineup).toBe(before.lineup);
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

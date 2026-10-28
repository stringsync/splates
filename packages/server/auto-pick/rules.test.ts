import { describe, expect, it } from "bun:test";
import { DEFAULT_RULES } from "./defaults";
import { type AutoPickRules, checkRules, ruleLabel } from "./rules";

describe("checkRules", () => {
	it("accepts certainty conditions without changing rules that omit them", () => {
		const rules: AutoPickRules = {
			...DEFAULT_RULES,
			rules: [
				{
					kind: "*",
					depth: "deep",
					clarity: "settled",
					picks: [{ agent: "claude" }],
				},
				{ kind: "*", depth: "*", picks: [{ agent: "codex" }] },
			],
		};
		expect(checkRules(rules)).toEqual({ ok: true, rules });
		expect(ruleLabel({ kind: "*", depth: "deep", clarity: "settled" })).toBe(
			"any kind, Deep, Calls settled",
		);
		expect(
			checkRules({
				...rules,
				rules: [{ ...rules.rules[0], clarity: "confident" }, rules.rules[1]],
			}),
		).toMatchObject({ ok: false });
		expect(
			checkRules({
				...rules,
				rules: [{ ...rules.rules[1], clarity: "settled" }],
			}),
		).toMatchObject({ ok: false });
	});

	it("passes the defaults, which end on any kind and any depth", () => {
		expect(checkRules(DEFAULT_RULES)).toEqual({
			ok: true,
			rules: DEFAULT_RULES,
		});
		expect(DEFAULT_RULES.rules.at(-1)).toMatchObject({
			kind: "*",
			depth: "*",
		});
	});

	it("puts each default task class on its intended primary pick", () => {
		expect(DEFAULT_RULES.rules.map((each) => each.picks[0])).toEqual([
			{ agent: "claude", model: "sonnet", effort: "low" },
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "claude", model: "opus", effort: "medium" },
			{ agent: "claude", model: "sonnet", effort: "medium" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "claude", model: "opus", effort: "high" },
			{ agent: "kimi", model: "kimi-code/k3.1-pro", effort: "max" },
			{ agent: "claude", model: "opus", effort: "medium" },
		]);
	});

	it("refuses rules whose last is not * *, saying where", () => {
		expect(
			checkRules({
				format: 2,
				threshold: 0.5,
				rules: [
					{ kind: "*", depth: "*", picks: [{ agent: "claude" }] },
					{ kind: "bugfix", depth: "*", picks: [{ agent: "claude" }] },
				],
			}),
		).toEqual({
			ok: false,
			problem:
				"rules.1: the last rule must be kind * and depth * with any certainty, so every task maps to a pick",
		});
	});

	it("refuses a rule with no picks", () => {
		expect(
			checkRules({
				format: 2,
				threshold: 0.5,
				rules: [{ kind: "*", depth: "*", picks: [] }],
			}),
		).toEqual({
			ok: false,
			problem: "rules.0.picks: a rule picks at least one agent",
		});
	});

	it("refuses a kind it does not know and a threshold past 1", () => {
		expect(
			checkRules({
				format: 2,
				threshold: 0.5,
				rules: [{ kind: "chore", depth: "*", picks: [{ agent: "a" }] }],
			}),
		).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^rules\.0\.kind: /),
		});
		expect(checkRules({ ...DEFAULT_RULES, threshold: 1.5 })).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^threshold: /),
		});
	});

	it("takes a mapping with no pace, and refuses a slack past 1", () => {
		const { pace: _, ...without } = DEFAULT_RULES;
		expect(checkRules(without)).toEqual({ ok: true, rules: without });
		expect(
			checkRules({
				...DEFAULT_RULES,
				pace: { on: true, slack: 1.5, spent: 0.95 },
			}),
		).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^pace\.slack: /),
		});
	});

	it("names what a rule matches in words", () => {
		expect(ruleLabel({ kind: "bugfix", depth: "*" })).toBe("Bugfix, any depth");
		expect(ruleLabel({ kind: "*", depth: "deep" })).toBe("any kind, Deep");
	});

	it("carries difficulty into depth in order, retaining picks, threshold and pace", () => {
		const picks = [{ agent: "claude", model: "sonnet", effort: "medium" }];
		const pace = { on: false, slack: 0.2, spent: 0.9 };
		expect(
			checkRules({
				format: 1,
				threshold: 0.7,
				pace,
				rules: [
					{ kind: "mechanical", difficulty: "easy", picks },
					{ kind: "bugfix", difficulty: "medium", picks },
					{ kind: "design", difficulty: "hard", picks },
					{ kind: "*", difficulty: "*", picks },
				],
			}),
		).toEqual({
			ok: true,
			rules: {
				format: 2,
				threshold: 0.7,
				pace,
				rules: [
					{ kind: "*", depth: "shallow", picks },
					{ kind: "bugfix", depth: "moderate", picks },
					{ kind: "design", depth: "deep", picks },
					{ kind: "*", depth: "*", picks },
				],
			},
		});
	});
	it("narrows removed kind-only rows instead of creating an early catch-all", () => {
		const picks = [{ agent: "claude" }];
		expect(
			checkRules({
				format: 1,
				threshold: 0.5,
				rules: [
					{ kind: "lookup", difficulty: "*", picks },
					{ kind: "mechanical", difficulty: "*", picks },
					{ kind: "*", difficulty: "*", picks },
				],
			}),
		).toMatchObject({
			ok: true,
			rules: {
				rules: [
					{ kind: "*", depth: "shallow" },
					{ kind: "*", depth: "moderate" },
					{ kind: "*", depth: "*" },
				],
			},
		});
	});
});

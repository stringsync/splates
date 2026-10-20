import { describe, expect, it } from "bun:test";
import { DEFAULT_RULES } from "./defaults";
import { checkRules, ruleLabel } from "./rules";

describe("checkRules", () => {
	it("passes the defaults, which end on any kind and any difficulty", () => {
		expect(checkRules(DEFAULT_RULES)).toEqual({
			ok: true,
			rules: DEFAULT_RULES,
		});
		expect(DEFAULT_RULES.rules.at(-1)).toMatchObject({
			kind: "*",
			difficulty: "*",
		});
	});

	it("refuses rules whose last is not * *, saying where", () => {
		expect(
			checkRules({
				format: 1,
				threshold: 0.5,
				rules: [
					{ kind: "*", difficulty: "*", picks: [{ agent: "claude" }] },
					{ kind: "bugfix", difficulty: "*", picks: [{ agent: "claude" }] },
				],
			}),
		).toEqual({
			ok: false,
			problem:
				"rules.1: the last rule must be kind * and difficulty *, so every task maps to a pick",
		});
	});

	it("refuses a rule with no picks", () => {
		expect(
			checkRules({
				format: 1,
				threshold: 0.5,
				rules: [{ kind: "*", difficulty: "*", picks: [] }],
			}),
		).toEqual({
			ok: false,
			problem: "rules.0.picks: a rule picks at least one agent",
		});
	});

	it("refuses a kind it does not know and a threshold past 1", () => {
		expect(
			checkRules({
				format: 1,
				threshold: 0.5,
				rules: [{ kind: "chore", difficulty: "*", picks: [{ agent: "a" }] }],
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
		expect(ruleLabel({ kind: "mechanical", difficulty: "*" })).toBe(
			"Mechanical, any difficulty",
		);
		expect(ruleLabel({ kind: "*", difficulty: "hard" })).toBe("any kind, Hard");
	});
});

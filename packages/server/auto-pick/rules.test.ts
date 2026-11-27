import { describe, expect, it } from "bun:test";
import { cellLabel, idFor, ROUTE_DEPTHS, ROUTE_KINDS } from "./cells";
import { DEFAULT_RULES } from "./defaults";
import {
	type AutoPickRules,
	checkRules,
	type Lineup,
	lineupFor,
} from "./rules";

const sonnet = { agent: "claude", model: "sonnet", effort: "medium" };
const sol = { agent: "codex", model: "gpt-6.1-sol", effort: "medium" };
const opus = { agent: "claude", model: "opus", effort: "medium" };

/** Rules with one lineup, every cell sent to it. */
function single(lineup: Lineup): AutoPickRules {
	return {
		format: 3,
		threshold: 0.5,
		lineups: [lineup],
		routes: Object.fromEntries(
			ROUTE_KINDS.map((kind) => [
				kind,
				Object.fromEntries(ROUTE_DEPTHS.map((depth) => [depth, lineup.id])),
			]),
		) as AutoPickRules["routes"],
	};
}

const ONE: Lineup = { id: "one", name: "One", color: "sky", picks: [sonnet] };

describe("checkRules", () => {
	it("passes the defaults, every cell sent to a lineup they list", () => {
		expect(checkRules(DEFAULT_RULES)).toEqual({
			ok: true,
			rules: DEFAULT_RULES,
		});
		const ids = DEFAULT_RULES.lineups.map((each) => each.id);
		expect(
			ROUTE_KINDS.flatMap((kind) =>
				ROUTE_DEPTHS.filter(
					(depth) => !ids.includes(DEFAULT_RULES.routes[kind][depth]),
				),
			),
		).toEqual([]);
	});

	it("sends default work where its lineup is meant for", () => {
		const name = (kind: string | null, depth: string | null) =>
			lineupFor(DEFAULT_RULES, kind as never, depth as never)?.name;
		expect(name("devops", "deep")).toBe("Infra");
		expect(name("bugfix", "shallow")).toBe("Quick");
		expect(name("design", "moderate")).toBe("Thoughtful");
		expect(name("bugfix", "moderate")).toBe("Standard");
		expect(name("open", "deep")).toBe("Careful");
		expect(name(null, "deep")).toBe("Hardest");
		expect(name(null, null)).toBe("Standard");
	});

	it("refuses a cell sent to a lineup it does not list, saying where", () => {
		const rules = single(ONE);
		rules.routes.bugfix.deep = "gone";
		expect(checkRules(rules)).toEqual({
			ok: false,
			problem: "routes.bugfix.deep: no lineup has the id 'gone'",
		});
	});

	it("refuses a missing cell", () => {
		const rules = single(ONE);
		const { deep: _, ...rest } = rules.routes.open;
		expect(
			checkRules({ ...rules, routes: { ...rules.routes, open: rest } }),
		).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^routes\.open\.deep: /),
		});
	});

	it("refuses a lineup with no picks, or the same model twice", () => {
		expect(checkRules(single({ ...ONE, picks: [] }))).toEqual({
			ok: false,
			problem: "lineups.0.picks: a lineup picks at least one agent",
		});
		expect(
			checkRules(
				single({ ...ONE, picks: [sonnet, { ...sonnet, effort: "high" }] }),
			),
		).toEqual({
			ok: false,
			problem:
				"lineups.0.picks.1: a lineup allows only one pick per agent plan; choose a different agent for the fallback",
		});
	});

	it.each([opus, { agent: "claude" }])(
		"refuses another model or default of the same agent: %j",
		(fallback) => {
			expect(
				checkRules(single({ ...ONE, picks: [sonnet, sol, fallback] })),
			).toEqual({
				ok: false,
				problem:
					"lineups.0.picks.2: a lineup allows only one pick per agent plan; choose a different agent for the fallback",
			});
		},
	);

	it("lets Antigravity's Claude follow its Gemini, on a quota of its own", () => {
		const gemini = { agent: "antigravity", model: "gemini-4-neon" };
		const claude = { agent: "antigravity", model: "claude-sonnet-5-5" };
		expect(
			checkRules(single({ ...ONE, picks: [sonnet, gemini, claude] })).ok,
		).toBe(true);
		expect(
			checkRules(
				single({
					...ONE,
					picks: [gemini, { agent: "antigravity", model: "gemini-4-carbon" }],
				}),
			),
		).toEqual({
			ok: false,
			problem:
				"lineups.0.picks.1: a lineup allows only one pick per agent plan; choose a different agent for the fallback",
		});
		expect(
			checkRules(single({ ...ONE, picks: [gemini, { agent: "antigravity" }] }))
				.ok,
		).toBe(false);
	});

	it("refuses two lineups with one name or id", () => {
		const rules = single(ONE);
		expect(
			checkRules({
				...rules,
				lineups: [ONE, { ...ONE, id: "two", name: "one " }],
			}),
		).toEqual({
			ok: false,
			problem: "lineups.1.name: two lineups are named 'one'",
		});
		expect(
			checkRules({ ...rules, lineups: [ONE, { ...ONE, name: "Two" }] }),
		).toEqual({
			ok: false,
			problem: "lineups.1.id: two lineups have the id 'one'",
		});
	});

	it("refuses a threshold past 1 and a slack past 1, and takes no pace", () => {
		expect(checkRules({ ...DEFAULT_RULES, threshold: 1.5 })).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^threshold: /),
		});
		expect(
			checkRules({
				...DEFAULT_RULES,
				pace: { on: true, slack: 1.5, spent: 0.95 },
			}),
		).toMatchObject({
			ok: false,
			problem: expect.stringMatching(/^pace\.slack: /),
		});
		const { pace: _, ...without } = DEFAULT_RULES;
		expect(checkRules(without)).toEqual({ ok: true, rules: without });
	});

	it("names a cell in words", () => {
		expect(cellLabel("bugfix", "deep")).toBe("Bugfix · Deep");
		expect(cellLabel(null, "unsure")).toBe("Unsure · Unsure");
	});

	it("makes ids no lineup has", () => {
		expect(idFor("Very careful!", [])).toBe("very-careful");
		expect(idFor("Quick", [{ id: "quick" }, { id: "quick-2" }])).toBe(
			"quick-3",
		);
		expect(idFor("???", [])).toBe("lineup");
	});

	it("converts format 2, sending each cell where its first matching rule did, sharing lineups", () => {
		const pace = { on: true, slack: 0.2, spent: 1 };
		const checked = checkRules({
			format: 2,
			threshold: 0.6,
			pace,
			rules: [
				{ kind: "bugfix", depth: "deep", picks: [opus] },
				{ kind: "*", depth: "deep", clarity: "unresolved", picks: [sol] },
				{
					kind: "*",
					depth: "shallow",
					picks: [{ ...sonnet, effort: "low" }, sol],
				},
				{ kind: "*", depth: "*", picks: [opus, sol] },
			],
		});
		expect(checked.ok).toBe(true);
		const rules = (checked as { rules: AutoPickRules }).rules;
		expect(rules.format).toBe(3);
		expect(rules.threshold).toBe(0.6);
		expect(rules.pace).toEqual(pace);
		expect(rules.lineups).toEqual([
			{
				id: "bugfix-deep",
				name: "Bugfix deep",
				color: "emerald",
				picks: [opus],
			},
			{
				id: "shallow",
				name: "Shallow",
				color: "sky",
				picks: [{ ...sonnet, effort: "low" }, sol],
			},
			{
				id: "fallback",
				name: "Fallback",
				color: "violet",
				picks: [opus, sol],
			},
		]);
		expect(rules.routes.bugfix).toEqual({
			unsure: "fallback",
			shallow: "shallow",
			moderate: "fallback",
			deep: "bugfix-deep",
		});
		// The rule naming a certainty matches nothing, so deep falls through.
		expect(rules.routes.design.deep).toBe("fallback");
		expect(rules.routes.unsure.shallow).toBe("shallow");
	});

	it("names a lineup two rules share after the broader one", () => {
		const checked = checkRules({
			format: 2,
			threshold: 0.5,
			rules: [
				{
					kind: "bugfix",
					depth: "shallow",
					picks: [{ ...sonnet, effort: "low" }, sol],
				},
				{
					kind: "*",
					depth: "moderate",
					picks: [{ ...sonnet, effort: "low" }, sol],
				},
				{ kind: "*", depth: "*", picks: [opus] },
			],
		});
		expect(checked).toMatchObject({
			ok: true,
			rules: {
				lineups: [
					{ id: "moderate", name: "Moderate", color: "emerald" },
					{ id: "fallback", name: "Fallback", color: "sky" },
				],
				routes: { bugfix: { shallow: "moderate", moderate: "moderate" } },
			},
		});
	});

	it("names a converted lineup as the defaults do when it has their picks", () => {
		const standard = DEFAULT_RULES.lineups.find(
			(each) => each.id === "standard",
		);
		const checked = checkRules({
			format: 2,
			threshold: 0.5,
			rules: [
				{ kind: "*", depth: "moderate", picks: standard?.picks },
				{ kind: "*", depth: "*", picks: standard?.picks.toReversed() },
			],
		});
		// The catch-all is Standard's picks in another order, so it joins it.
		expect(checked).toMatchObject({
			ok: true,
			rules: { lineups: [{ id: "standard", name: "Standard", color: "sky" }] },
		});
	});

	it("carries format 1 through format 2", () => {
		expect(
			checkRules({
				format: 1,
				threshold: 0.7,
				rules: [
					{ kind: "mechanical", difficulty: "*", picks: [sol] },
					{ kind: "bugfix", difficulty: "hard", picks: [opus] },
					{ kind: "*", difficulty: "*", picks: [sonnet] },
				],
			}),
		).toMatchObject({
			ok: true,
			rules: {
				format: 3,
				routes: {
					bugfix: {
						moderate: "moderate",
						deep: "bugfix-deep",
						shallow: "fallback",
					},
				},
			},
		});
	});
});

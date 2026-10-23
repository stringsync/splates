import { describe, expect, it } from "bun:test";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide, decideDeeper, decideWithout } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";
import { setOf } from "./start";

const DESIGN: Classification = {
	kinds: { bugfix: 0.1, design: 0.9, open: 0.1 },
	depth: { shallow: 0.1, moderate: 0.2, deep: 0.8 },
};
const BASE = {
	rules: DEFAULT_RULES,
	agents: DEFAULT_AGENTS,
	runnable: DEFAULT_AGENTS.map((each) => each.id),
	limits: {},
	offered: {},
	now: new Date("2026-10-19T12:00:00Z"),
};

describe("Auto pick certainty", () => {
	it("routes settled deep work to Opus without reducing reasoning depth or effort", () => {
		const result = decide({
			...BASE,
			classification: { ...DESIGN, clarity: { settled: 0.9, unresolved: 0.1 } },
		});
		expect(result).toMatchObject({
			pick: { agent: "claude", model: "opus", effort: "high" },
			depth: "deep",
			clarity: "settled",
		});
		expect(result.reasons).toContain("rule 4: any kind, Deep, Calls settled");
		expect(setOf(result)).toMatchObject({ clarity: "settled", depth: "deep" });
	});

	it.each([
		{ kinds: DESIGN.kinds, depth: DESIGN.depth },
		{ ...DESIGN, clarity: { settled: 0.1, unresolved: 0.9 } },
		{ ...DESIGN, clarity: { settled: 0.4, unresolved: 0.3 } },
		{ ...DESIGN, clarity: { settled: 0.5, unresolved: 0.5 } },
		{ ...DESIGN, clarity: { settled: 0.5, unresolved: 0.1 } },
	])(
		"keeps exploratory or unknown certainty on the existing depth route: %j",
		(classification) => {
			expect(decide({ ...BASE, classification })).toMatchObject({
				pick: { model: "fable" },
				depth: "deep",
			});
		},
	);

	it("matches unresolved certainty and respects the judge threshold independently", () => {
		const rules: AutoPickRules = {
			...DEFAULT_RULES,
			threshold: 0.95,
			rules: [
				{
					kind: "*",
					depth: "*",
					clarity: "unresolved",
					picks: [{ agent: "codex" }],
				},
				{ kind: "*", depth: "*", picks: [{ agent: "claude" }] },
			],
		};
		expect(
			decide({
				...BASE,
				rules,
				classification: {
					...DESIGN,
					clarity: { settled: 0.1, unresolved: 0.9 },
				},
			}),
		).toMatchObject({ pick: { agent: "claude" }, clarity: null });
		expect(
			decide({
				...BASE,
				rules: { ...rules, threshold: 0.8 },
				classification: {
					...DESIGN,
					clarity: { settled: 0.1, unresolved: 0.9 },
				},
			}),
		).toMatchObject({ pick: { agent: "codex" }, clarity: "unresolved" });
	});

	it("preserves settled choices when taking a conversation one depth deeper", () => {
		expect(
			decideDeeper(
				BASE,
				{ kind: "design", depth: "moderate", clarity: "settled" },
				"asked back",
			),
		).toMatchObject({
			pick: { model: "opus", effort: "high" },
			depth: "deep",
			clarity: "settled",
		});
	});
	it("skips certainty-specific rules without a judge", () => {
		const rules: AutoPickRules = {
			...DEFAULT_RULES,
			rules: [
				{
					kind: "*",
					depth: "*",
					clarity: "settled",
					picks: [{ agent: "codex" }],
				},
				{ kind: "*", depth: "*", picks: [{ agent: "claude" }] },
			],
		};
		expect(decideWithout({ ...BASE, rules, reason: "no judge" })).toMatchObject(
			{ pick: { agent: "claude" }, rule: 1 },
		);
	});
});

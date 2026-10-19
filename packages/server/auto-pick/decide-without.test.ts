import { describe, expect, it } from "bun:test";
import { DEFAULT_AGENTS } from "../models";
import { decideWithout } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import type { AutoPickRules } from "./rules";

describe("decideWithout", () => {
	it("takes the last rule of the defaults, the first to match any kind and difficulty", () => {
		expect(
			decideWithout({
				reason: "the judge took over 5s",
				rules: DEFAULT_RULES,
				agents: DEFAULT_AGENTS,
				runnable: DEFAULT_AGENTS.map((each) => each.id),
				limits: {},
				offered: {},
				now: new Date("2026-10-19T12:00:00Z"),
			}),
		).toEqual({
			pick: { agent: "claude", model: "opus", effort: "medium" },
			rule: 10,
			kind: null,
			difficulty: null,
			reasons: [
				"Opus 5.5, medium effort",
				"the judge took over 5s",
				"rule 11: any kind, any difficulty",
			],
		});
	});

	it("skips rules that name a kind or an difficulty", () => {
		const rules: AutoPickRules = {
			format: 1,
			threshold: 0.5,
			rules: [
				{
					kind: "lookup",
					difficulty: "*",
					picks: [{ agent: "claude", model: "haiku" }],
				},
				{
					kind: "*",
					difficulty: "easy",
					picks: [{ agent: "claude", model: "haiku" }],
				},
				{ kind: "*", difficulty: "*", picks: [{ agent: "codex" }] },
			],
		};
		expect(
			decideWithout({
				reason: "no judge",
				rules,
				agents: DEFAULT_AGENTS,
				runnable: DEFAULT_AGENTS.map((each) => each.id),
				limits: {},
				offered: {},
				now: new Date("2026-10-19T12:00:00Z"),
			}),
		).toMatchObject({ pick: { agent: "codex" }, rule: 2 });
	});
});

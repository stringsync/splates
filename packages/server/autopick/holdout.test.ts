import { describe, expect, it } from "bun:test";
import type { Setting } from "../conversations";
import { DEFAULT_AGENTS } from "../models";
import type { Classification } from "./classify";
import { decide } from "./decide";
import { DEFAULT_RULES } from "./defaults";
import { assigned, HOLDOUT_VERSION, holdBack } from "./holdout";
import type { AutopickRules } from "./rules";
import { withCell } from "./testing";

describe("holdout", () => {
	it("takes about its share of tasks, the same ones every time", () => {
		const tasks = Array.from({ length: 2000 }, (_, at) => at + 1);
		const held = tasks.filter((task) => assigned(task, 0.1));
		expect(held.length / tasks.length).toBeGreaterThan(0.07);
		expect(held.length / tasks.length).toBeLessThan(0.13);
		expect(tasks.filter((task) => assigned(task, 0.1))).toEqual(held);
	});

	it("draws a fresh sample under another version", () => {
		const tasks = Array.from({ length: 200 }, (_, at) => at + 1);
		expect(tasks.filter((task) => assigned(task, 0.5, "other"))).not.toEqual(
			tasks.filter((task) => assigned(task, 0.5)),
		);
	});

	it("takes none at a share of 0 and all at 1", () => {
		expect(assigned(7, 0)).toBe(false);
		expect(assigned(7, 1)).toBe(true);
	});

	const on = (rules: AutopickRules = DEFAULT_RULES): AutopickRules => ({
		...rules,
		holdout: { on: true, share: 1 },
	});
	const held = (
		classification: Classification,
		rules = on(),
		offered: Record<string, Setting[]> = {},
	) => {
		const context = { ...BASE, rules, offered };
		return holdBack(decide({ ...context, classification }), context, 42);
	};

	it("starts a deep task on the moderate lineup's pick of the same agent, saying why", () => {
		const decision = held(DEEP_DESIGN, on(), { claude: [MODEL, EFFORT] });
		expect(decision.pick).toEqual({
			agent: "claude",
			model: "sonnet",
			effort: "high",
		});
		expect(decision.lineup).toBe("thoughtful");
		expect(decision.kind).toBe("design");
		expect(decision.depth).toBe("deep");
		expect(decision.reasons[1]).toBe(
			"held out: started as moderate, one difficulty easier, as an experiment; the cell picks Opus 5.5, high effort",
		);
		expect(decision.reasons).toContain("route: Design · Moderate → Thoughtful");
		expect(decision.reasons).not.toContain("route: Design · Deep → Careful");
		expect(decision.holdout).toEqual({
			version: HOLDOUT_VERSION,
			lineup: "careful",
			from: "Opus 5.5, high effort",
			undo: { model: "opus", effort: "high" },
		});
	});

	it("leaves a task alone while the holdout is off", () => {
		const decision = held(DEEP_DESIGN, DEFAULT_RULES);
		expect(decision.lineup).toBe("careful");
		expect(decision.holdout).toBeUndefined();
	});

	it("leaves a task outside its share alone", () => {
		const rules = { ...DEFAULT_RULES, holdout: { on: true, share: 0 } };
		expect(held(DEEP_DESIGN, rules).holdout).toBeUndefined();
	});

	it("never holds out a shallow task, with none easier", () => {
		expect(held(SHALLOW_BUGFIX).holdout).toBeUndefined();
	});

	it("never holds out a task whose depth the judge was unsure of", () => {
		expect(
			held({
				...DEEP_DESIGN,
				depth: { shallow: 0.3, moderate: 0.3, deep: 0.3 },
			}).holdout,
		).toBeUndefined();
	});

	it("leaves a task alone when the easier cell picks another agent", () => {
		const rules = withCell(on(), "design", "moderate", "Elsewhere", [
			{ agent: "codex", model: "gpt-6.1-sol", effort: "low" },
		]);
		const decision = held(DEEP_DESIGN, rules);
		expect(decision.lineup).toBe("careful");
		expect(decision.holdout).toBeUndefined();
	});

	it("leaves a task alone when the easier cell picks no lower", () => {
		const rules = withCell(on(), "design", "moderate", "Same", [
			{ agent: "claude", model: "opus", effort: "high" },
		]);
		expect(held(DEEP_DESIGN, rules).holdout).toBeUndefined();
	});
});

/** A design task the judge takes for deep work. */
const DEEP_DESIGN: Classification = {
	kinds: { bugfix: 0.1, design: 0.9, open: 0.1, devops: 0.1 },
	depth: { shallow: 0.1, moderate: 0.2, deep: 0.8 },
};

/** A bugfix task the judge takes for shallow work. */
const SHALLOW_BUGFIX: Classification = {
	kinds: { bugfix: 0.8, design: 0.1, open: 0.1, devops: 0.1 },
	depth: { shallow: 0.8, moderate: 0.2, deep: 0.1 },
};

const BASE = {
	agents: DEFAULT_AGENTS,
	runnable: DEFAULT_AGENTS.map((each) => each.id),
	limits: {},
	now: new Date("2026-10-19T12:00:00Z"),
};

const MODEL: Setting = {
	id: "model",
	name: "Model",
	type: "select",
	category: "model",
	current: "sonnet",
	options: [
		{ value: "sonnet", name: "Sonnet", description: null },
		{ value: "opus", name: "Opus", description: null },
	],
};

const EFFORT: Setting = {
	id: "effort",
	name: "Effort",
	type: "select",
	category: "thought_level",
	current: "medium",
	options: ["low", "medium", "high"].map((value) => ({
		value,
		name: value,
		description: null,
	})),
};

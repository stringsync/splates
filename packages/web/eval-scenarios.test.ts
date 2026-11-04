import { describe, expect, test } from "bun:test";
import type {
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import {
	countStates,
	filterRows,
	passCount,
	projectsOf,
	rowsOf,
	summaryOf,
} from "./eval-scenarios";

describe("the scenario table", () => {
	test("rows read worst first, the lowest pass rate first among failing, a scenario without a state as never run", () => {
		const { scenarios, states } = fixture();
		expect(rowsOf(scenarios, states).map((row) => row.scenario.id)).toEqual([
			"c",
			"b",
			"e",
			"a",
			"d",
		]);
	});

	test("counts each state and summarises", () => {
		const { scenarios, states } = fixture();
		const rows = rowsOf(scenarios, states);
		expect(countStates(rows)).toEqual({
			failing: 2,
			"never-run": 1,
			passing: 2,
		});
		expect(summaryOf(rows)).toBe("2 of 5 scenarios passing");
	});

	test("filters by state and by project together", () => {
		const { scenarios, states } = fixture();
		const rows = rowsOf(scenarios, states);
		expect(
			filterRows(rows, { state: "failing", project: "x" }).map(
				(row) => row.scenario.id,
			),
		).toEqual(["b"]);
		expect(filterRows(rows, { state: null, project: null })).toHaveLength(5);
	});

	test("lists projects without the unnamed", () => {
		const { scenarios, states } = fixture();
		expect(projectsOf(rowsOf(scenarios, states))).toEqual(["y", "x"]);
	});

	test("passCount is the agent's passed of total, null when it did not run", () => {
		const pick = { agent: "claude", model: "sonnet", effort: "high" } as const;
		const ran = state("b", "failing", 2, 3);
		ran.targets = [{ target: "claude/sonnet@high", passed: 2, total: 3 }];
		expect(passCount(ran, pick)).toBe("2/3");
		expect(passCount(ran, { ...pick, model: "opus" })).toBeNull();
	});
});

function scenario(id: string, skill?: string): EvalScenario {
	return { id, group: null, about: null, ...(skill ? { skill } : {}) };
}

function state(
	id: string,
	status: EvalScenarioState["state"],
	passed = 0,
	total = 0,
): EvalScenarioState {
	return {
		scenario: id,
		state: status,
		targets: total === 0 ? [] : [{ target: "t", passed, total }],
		lastRunAt: total === 0 ? null : "2026-01-01T00:00:00Z",
		run: null,
	};
}

function fixture(): {
	scenarios: EvalScenario[];
	states: EvalScenarioState[];
} {
	return {
		scenarios: [
			scenario("a", "x"),
			scenario("b", "x"),
			scenario("c", "y"),
			scenario("d", "y"),
			scenario("e"),
		],
		states: [
			state("a", "passing", 3, 3),
			state("b", "failing", 2, 3),
			state("c", "failing", 0, 3),
			state("d", "passing", 3, 3),
		],
	};
}

import { describe, expect, test } from "bun:test";
import type {
	EvalScenario,
	EvalScenarioState,
} from "@splates/server/evals/browser";
import {
	countStates,
	filesOf,
	filterRows,
	needsRunsCount,
	passCount,
	passRateOf,
	rowsOf,
	suitesOf,
	summaryOf,
	tallyOf,
	titleOf,
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
			"needs-runs": 0,
			"never-run": 1,
			passing: 2,
		});
		expect(summaryOf(rows)).toBe("2 of 5 specs passing");
	});

	test("filters by state", () => {
		const { scenarios, states } = fixture();
		const rows = rowsOf(scenarios, states);
		expect(
			filterRows(rows, { state: "failing" }).map((row) => row.scenario.id),
		).toEqual(["c", "b"]);
		expect(filterRows(rows, { state: null })).toHaveLength(5);
	});

	test("a spec's pass rate is a whole percent of its runs, null when never run", () => {
		expect(passRateOf(state("b", "failing", 2, 3))).toBe(67);
		expect(passRateOf(state("e", "never-run"))).toBeNull();
	});

	test("a suite or group tallies failing then passing", () => {
		const { scenarios, states } = fixture();
		const rows = rowsOf(scenarios, states);
		expect(tallyOf(rows)).toBe("2 failing · 2 passing");
		expect(tallyOf(rows.filter((row) => row.state.state === "never-run"))).toBe(
			"not run",
		);
	});

	test("a spec short of passes reads needs runs, with its passes of the window", () => {
		const short = state("d", "needs-runs", 1, 1);
		short.targets = [
			{
				target: "t",
				passed: 1,
				total: 1,
				standing: "needs-runs",
				need: 2,
				of: 3,
			},
		];
		expect(needsRunsCount(short)).toBe("1/3");
		expect(needsRunsCount(state("e", "passing", 2, 2))).toBeNull();
		expect(tallyOf(rowsOf([scenario("d")], [short]))).toBe("1 need runs");
	});

	test("passCount is the agent's passed of total, null when it did not run", () => {
		const pick = { agent: "claude", model: "sonnet", effort: "high" } as const;
		const ran = state("b", "failing", 2, 3);
		ran.targets = [
			{
				target: "claude/sonnet@high",
				passed: 2,
				total: 3,
				standing: "pass",
				need: 2,
				of: 3,
			},
		];
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
		targets:
			total === 0
				? []
				: [
						{
							target: "t",
							passed,
							total,
							standing: status === "failing" ? "fail" : "pass",
							need: 2,
							of: 3,
						},
					],
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

describe("specs as suites and groups", () => {
	test("a spec reads as its sentence, else what it checks, else its id", () => {
		expect(
			titleOf({ ...scenario("a"), sentence: "asks first", about: "long" }),
		).toBe("asks first");
		expect(titleOf({ ...scenario("a"), about: "long" })).toBe("long");
		expect(titleOf(scenario("a"))).toBe("a");
	});

	test("splits specs by their describe groups: suites in first-seen order, groups A to Z, cases without groups under their skill", () => {
		const spec = (id: string, groups: string[]): EvalScenario => ({
			...scenario(id),
			groups,
		});
		const rows = rowsOf(
			[
				spec("q", ["splates skill", "queueing"]),
				spec("a", ["splates skill", "asking"]),
				spec("n", ["splates skill", "asking", "nested"]),
				spec("top", ["splates skill"]),
				scenario("legacy", "vexml"),
			],
			[],
		);
		expect(
			suitesOf(rows).map((suite) => ({
				name: suite.name,
				loose: suite.loose.map((row) => row.scenario.id),
				groups: suite.groups.map((group) => [
					group.name,
					group.rows.map((row) => row.scenario.id),
				]),
			})),
		).toEqual([
			{
				name: "splates skill",
				loose: ["top"],
				groups: [
					["asking", ["a"]],
					["asking › nested", ["n"]],
					["queueing", ["q"]],
				],
			},
			{ name: "vexml", loose: ["legacy"], groups: [] },
		]);
	});
});

describe("specs by file", () => {
	test("groups specs by the file that holds them, A to Z by path, a spec with no file under its suite", () => {
		const rows = rowsOf(
			[
				{
					...scenario("q"),
					groups: ["splates skill", "queueing"],
					file: "skills/evals/queueing.ts",
					fileAt: "/repo/skills/evals/queueing.ts",
				},
				{ ...scenario("a"), file: "skills/evals/asking.ts" },
				{ ...scenario("a2"), file: "skills/evals/asking.ts" },
				{ ...scenario("other"), groups: ["vexml"] },
			],
			[],
		);
		expect(
			filesOf(rows).map(({ key, name, folder, at, rows }) => ({
				key,
				name,
				folder,
				at,
				ids: rows.map((row) => row.scenario.id),
			})),
		).toEqual([
			{
				key: "skills/evals/asking.ts",
				name: "asking.ts",
				folder: "skills/evals/",
				at: null,
				ids: ["a", "a2"],
			},
			{
				key: "skills/evals/queueing.ts",
				name: "queueing.ts",
				folder: "skills/evals/",
				at: "/repo/skills/evals/queueing.ts",
				ids: ["q"],
			},
			{ key: "vexml", name: "vexml", folder: "", at: null, ids: ["other"] },
		]);
	});
});

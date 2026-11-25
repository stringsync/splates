import type { EvalScenario } from "./launch";
import { DEFAULT_PASS, standingOf } from "./pass-rule";
import type {
	EvalCell,
	EvalGrid,
	EvalScenarioState,
	EvalScenarioStatus,
	EvalScenarioTarget,
} from "./types";

/**
 * Where each of `scenarios` stands against the saved `grids`, for the Evals
 * page to list. Each agent is judged on its last `of` graded runs of the spec
 * across every batch, against the spec's pass rule; errored and pending runs
 * say nothing of the skill and are left out.
 */
export function scenarioStates(
	scenarios: EvalScenario[],
	grids: EvalGrid[],
): EvalScenarioState[] {
	const newestFirst = [...grids].sort((first, second) =>
		second.startedAt.localeCompare(first.startedAt),
	);
	return scenarios.map((scenario) => {
		const latest = newestFirst.find((grid) =>
			grid.grid.some(
				(cell) => cell.scenario === scenario.id && cell.run !== null,
			),
		);
		if (latest === undefined) {
			return {
				scenario: scenario.id,
				state: "never-run",
				targets: [],
				lastRunAt: null,
				run: null,
				batch: null,
			};
		}
		return stateOf(scenario, latest, newestFirst);
	});
}

function stateOf(
	scenario: EvalScenario,
	latest: EvalGrid,
	newestFirst: EvalGrid[],
): EvalScenarioState {
	const rule = scenario.pass ?? DEFAULT_PASS;
	const landed = latest.grid.filter(
		(cell) => cell.scenario === scenario.id && cell.run !== null,
	);
	const failed = landed.find(
		(cell) => cell.run?.status === "fail" || cell.run?.status === "error",
	);
	// Graded outcomes per agent, oldest first, over every batch on the checkout's skill.
	const outcomes = new Map<string, boolean[]>();
	for (const cell of landed) {
		outcomes.set(cell.target, []);
	}
	for (const grid of [...newestFirst].reverse()) {
		const baselines = new Set(
			grid.targets
				.filter((target) => target.skill !== null)
				.map((target) => target.key),
		);
		for (const cell of grid.grid) {
			if (cell.scenario !== scenario.id || baselines.has(cell.target)) {
				continue;
			}
			const mine = outcomes.get(cell.target);
			if (mine !== undefined && gradedOf(cell) !== null) {
				mine.push(gradedOf(cell) === true);
			}
		}
	}
	const targets: EvalScenarioTarget[] = [...outcomes].map(
		([target, graded]) => {
			const { standing, passed, window } = standingOf(graded, rule);
			return {
				target,
				passed,
				total: window,
				standing,
				need: rule.need,
				of: rule.of,
			};
		},
	);
	const state: EvalScenarioStatus = targets.some(
		(each) => each.standing === "fail",
	)
		? "failing"
		: targets.some((each) => each.standing === "needs-runs")
			? "needs-runs"
			: "passing";
	return {
		scenario: scenario.id,
		state,
		targets,
		lastRunAt: latest.startedAt,
		run: (failed ?? landed[0])?.run?.id ?? null,
		batch: latest.id,
	};
}

/** Whether a landed run passed (true) or failed (false); null when it says nothing of the skill. */
function gradedOf(cell: EvalCell): boolean | null {
	const status = cell.run?.status;
	return status === "pass" ? true : status === "fail" ? false : null;
}

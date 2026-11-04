import type { EvalScenario } from "./launch";
import type {
	EvalCell,
	EvalGrid,
	EvalScenarioState,
	EvalScenarioTarget,
} from "./types";

/** Where each of `scenarios` stands against the saved `grids`, for the Evals page to list. */
export function scenarioStates(
	scenarios: EvalScenario[],
	grids: EvalGrid[],
): EvalScenarioState[] {
	// Failing outranks stale; a run or scenario without a fingerprint is never stale.
	const newestFirst = [...grids].sort((first, second) =>
		second.startedAt.localeCompare(first.startedAt),
	);
	return scenarios.map((scenario) => {
		for (const grid of newestFirst) {
			const landed = grid.grid.filter(
				(cell) => cell.scenario === scenario.id && cell.run !== null,
			);
			if (landed.length > 0) {
				return stateOf(scenario, grid.startedAt, landed);
			}
		}
		return {
			scenario: scenario.id,
			state: "never-run",
			targets: [],
			lastRunAt: null,
			run: null,
		};
	});
}

function stateOf(
	scenario: EvalScenario,
	startedAt: string,
	landed: EvalCell[],
): EvalScenarioState {
	const failed = landed.find(
		(cell) => cell.run?.status === "fail" || cell.run?.status === "error",
	);
	const stale =
		scenario.fingerprint !== undefined &&
		landed.some(
			(cell) =>
				cell.fingerprint !== undefined &&
				cell.fingerprint !== scenario.fingerprint,
		);
	const targets: EvalScenarioTarget[] = [];
	for (const cell of landed) {
		let entry = targets.find((each) => each.target === cell.target);
		if (entry === undefined) {
			entry = { target: cell.target, passed: 0, total: 0 };
			targets.push(entry);
		}
		entry.total += 1;
		entry.passed += cell.run?.status === "pass" ? 1 : 0;
	}
	return {
		scenario: scenario.id,
		state: failed !== undefined ? "failing" : stale ? "stale" : "passing",
		targets,
		lastRunAt: startedAt,
		run: (failed ?? landed[0])?.run?.id ?? null,
	};
}

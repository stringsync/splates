import type {
	EvalGrid,
	EvalScenario,
	EvalStatus,
} from "@stringsync/splates-server/evals/browser";
import { ORDER } from "./eval-status";

/** How a scenario last went: the newest batch that ran it, and its cells' outcomes. */
export interface LastResult {
	batch: string;
	startedAt: string;
	cells: number;
	passed: number;
	/** The worst outcome among its cells, in the order `ORDER` reads them. */
	status: EvalStatus;
}

/** A skill's scenarios, under the heading the index shows. */
export interface ScenarioSection {
	heading: string;
	scenarios: EvalScenario[];
}

/** The scenarios grouped by the skill that owns them, else by their `group`, in the order first seen. */
export function sectionsOf(scenarios: EvalScenario[]): ScenarioSection[] {
	const sections: ScenarioSection[] = [];
	for (const scenario of scenarios) {
		const heading = scenario.skill ?? scenario.group ?? "";
		let section = sections.find((each) => each.heading === heading);
		if (section === undefined) {
			section = { heading, scenarios: [] };
			sections.push(section);
		}
		section.scenarios.push(scenario);
	}
	return sections;
}

/**
 * Each scenario's result in the newest of `grids` that ran it, a cell still
 * to land counting as pending. `grids` may come in any order.
 */
export function lastResults(grids: EvalGrid[]): Map<string, LastResult> {
	const results = new Map<string, LastResult>();
	const newest = [...grids].sort((left, right) =>
		right.startedAt.localeCompare(left.startedAt),
	);
	for (const grid of newest) {
		const seen = new Set<string>();
		for (const cell of grid.grid) {
			seen.add(cell.scenario);
		}
		for (const id of seen) {
			if (results.has(id)) {
				continue;
			}
			const statuses = grid.grid
				.filter((cell) => cell.scenario === id)
				.map((cell): EvalStatus => cell.run?.status ?? "pending");
			results.set(id, {
				batch: grid.id,
				startedAt: grid.startedAt,
				cells: statuses.length,
				passed: statuses.filter((each) => each === "pass").length,
				status: ORDER.find((each) => statuses.includes(each)) ?? "pass",
			});
		}
	}
	return results;
}

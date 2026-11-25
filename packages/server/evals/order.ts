import { runOrder } from "@evals/evals/order";
import type { Priority } from "@evals/evals/scenario";
import type { EvalScenario } from "./launch";
import type { EvalGrid, EvalTarget } from "./types";

/** A single scenario in the order a budget should run it, with its resolved priority and last run time. */
export interface EvalOrderedScenario extends EvalScenario {
	/** Resolved priority (`normal` when the spec sets none). */
	priority: Priority;
	/** When the latest batch with a landed run for this scenario (and agent, when filtered) started, as ISO 8601; null when never run. */
	lastRunAt: string | null;
}

/**
 * Single scenarios in run order: highest priority first (`high`, `normal`,
 * `low`), then never run, then oldest last run. When `agent` is given, only
 * runs on that agent count toward a scenario's last run.
 */
export function orderedScenarios(
	scenarios: readonly EvalScenario[],
	grids: readonly EvalGrid[],
	agent?: string | null,
): EvalOrderedScenario[] {
	const last = lastRunByScenario(grids, agent);
	return runOrder(scenarios, (each) => last.get(each.id)?.ms).map((each) => ({
		...each,
		priority: each.priority ?? "normal",
		lastRunAt: last.get(each.id)?.at ?? null,
	}));
}

/**
 * Each scenario's latest landed run timestamp from `grids`, ignoring pending
 * cells and baseline targets. When `agent` is non-empty, only cells for that
 * agent count.
 */
export function lastRunByScenario(
	grids: readonly EvalGrid[],
	agent?: string | null,
): Map<string, { at: string; ms: number }> {
	const filter = agent != null && agent !== "" ? agent : null;
	const latest = new Map<string, { at: string; ms: number }>();
	for (const grid of grids) {
		const ms = Date.parse(grid.startedAt);
		if (Number.isNaN(ms)) {
			continue;
		}
		const targets = new Map<string, EvalTarget>(
			grid.targets.map((target) => [target.key, target]),
		);
		for (const cell of grid.grid) {
			if (cell.run === null) {
				continue;
			}
			const target = targets.get(cell.target);
			if (target !== undefined && target.skill !== null) {
				continue;
			}
			if (filter !== null && !matchesAgent(cell.target, target, filter)) {
				continue;
			}
			const prev = latest.get(cell.scenario);
			if (prev === undefined || ms > prev.ms) {
				latest.set(cell.scenario, { at: grid.startedAt, ms });
			}
		}
	}
	return latest;
}

function matchesAgent(
	key: string,
	target: EvalTarget | undefined,
	agent: string,
): boolean {
	if (target !== undefined) {
		return target.agent === agent;
	}
	return (
		key === agent || key.startsWith(`${agent}/`) || key.startsWith(`${agent}:`)
	);
}

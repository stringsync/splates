import type { Priority } from "./scenario";

const rank: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

/**
 * Scenarios in the order a budget should run them: higher priority first
 * (unset is `normal`), then never run, then the oldest last run. `lastRun`
 * gives a scenario's last run in epoch milliseconds, or `undefined` when it
 * has none; ties keep the order given.
 */
export function runOrder<T extends { priority?: Priority }>(
	scenarios: readonly T[],
	lastRun: (scenario: T) => number | undefined,
): T[] {
	return scenarios
		.map((scenario, index) => ({
			scenario,
			index,
			rank: rank[scenario.priority ?? "normal"],
			last: lastRun(scenario),
		}))
		.sort(
			(one, other) =>
				one.rank - other.rank ||
				byLastRun(one.last, other.last) ||
				one.index - other.index,
		)
		.map((each) => each.scenario);
}

/** Never run before any run, then older before newer. */
function byLastRun(one: number | undefined, other: number | undefined): number {
	if (one === undefined || other === undefined) {
		return (one === undefined ? 0 : 1) - (other === undefined ? 0 : 1);
	}
	return one - other;
}

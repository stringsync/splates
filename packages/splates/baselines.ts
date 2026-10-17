import { keptDecisions, madeBy } from "./decided";
import type { Finding } from "./findings";
import type { Outcome } from "./outcomes";

/** Each project's baseline, over the merged tasks that ended in the window before `now`. */
export function baselines(outcomes: Outcome[], now: Date): Baseline[] {
	const from = now.getTime() - BASELINE.windowMs;
	const recent = outcomes.filter(
		(each) =>
			each.ended === "merged" &&
			!each.base.startsWith("task/") &&
			Date.parse(each.endedAt) >= from &&
			Date.parse(each.endedAt) <= now.getTime(),
	);
	return [...Map.groupBy(recent, (each) => each.project)].map(
		([project, tasks]) => ({
			project,
			tasks: tasks.length,
			measures: Object.fromEntries(
				MEASURES.map((measure) => [
					measure,
					spread(
						tasks.flatMap((each) => {
							const value = measured(each)[measure];
							return value === null ? [] : [value];
						}),
					),
				]),
			) as Record<Measure, Spread | null>,
			findings: counted(tasks),
		}),
	);
}

/**
 * What a project's recent merged tasks were like, so one task can be held
 * against them: each measure's median and 90th percentile, and how often each
 * kind of finding came up.
 */
export interface Baseline {
	/** The main tree of the repository. */
	project: string;
	/** Its merged tasks in the window. */
	tasks: number;
	/** Each measure over the tasks that kept it; null with too few to compare against. */
	measures: Record<Measure, Spread | null>;
	/** How many of its tasks had each finding, by `findingKeys`. */
	findings: Record<string, number>;
}

/** Where a measure's values fall among a project's tasks. */
export interface Spread {
	/** The tasks that kept it. */
	tasks: number;
	median: number;
	p90: number;
}

/** What a task is held against its project's on. */
export type Measure =
	/** From add to merge, in milliseconds. */
	| "spentMs"
	/** What its own turns cost; Codex says none. */
	| "cost"
	/** Lines added and removed. */
	| "lines"
	/** Calls the person made, asked or challenged. */
	| "decidedByYou"
	| "failedMerges";

export const MEASURES: readonly Measure[] = [
	"spentMs",
	"cost",
	"lines",
	"decidedByYou",
	"failedMerges",
];

/** Each tuned here, so a comparison that cries wolf is one number to change. */
export const BASELINE = {
	/** How far back the tasks compared against ended. */
	windowMs: 7 * 24 * 60 * 60 * 1000,
	/** Fewer tasks than this keeping a measure, and it gives no comparison. */
	minTasks: 10,
	/** A value is an outlier past the 90th percentile, or this many medians. */
	timesMedian: 2,
} as const;

/** What `outcome` shows of each measure; null for one it did not keep. */
export function measured(outcome: Outcome): Record<Measure, number | null> {
	return {
		spentMs: Date.parse(outcome.endedAt) - Date.parse(outcome.startedAt),
		cost: outcome.usage?.cost?.amount ?? null,
		lines:
			outcome.size === undefined
				? null
				: outcome.size.added + outcome.size.removed,
		decidedByYou: keptDecisions(outcome)
			? madeBy(outcome, "decidedByYou")
			: null,
		failedMerges: outcome.failedMerges,
	};
}

/** Whether `value` stands out from `spread`: never against no spread. */
export function outlier(value: number, spread: Spread | null): boolean {
	return (
		spread !== null &&
		(value > spread.p90 ||
			(spread.median > 0 && value > spread.median * BASELINE.timesMedian))
	);
}

/**
 * What a finding counts toward: its kind, and, for one that names what
 * failed, that too, so the same failing test is counted apart from others.
 */
export function findingKeys(finding: Finding): string[] {
	switch (finding.kind) {
		case "gate":
			return [
				`gate:${finding.reason}`,
				...(finding.tests ?? []).map(
					(test) => `gate:${finding.reason}:${test}`,
				),
				...(finding.files ?? []).map(
					(file) => `gate:${finding.reason}:${file}`,
				),
			];
		case "repeated_failure":
			return [finding.kind, `${finding.kind}:${finding.command}`];
		case "adherence":
			return [finding.kind, `${finding.kind}:${finding.check}`];
		default:
			return [finding.kind];
	}
}

/** How many of `tasks` had each finding key, a task counting once for each. */
function counted(tasks: Outcome[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const task of tasks) {
		for (const key of new Set((task.findings ?? []).flatMap(findingKeys))) {
			counts[key] = (counts[key] ?? 0) + 1;
		}
	}
	return counts;
}

function spread(values: number[]): Spread | null {
	if (values.length < BASELINE.minTasks) {
		return null;
	}
	const sorted = values.toSorted((one, other) => one - other);
	return {
		tasks: sorted.length,
		median: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
	};
}

/** The `share` quantile of `sorted`, between its two nearest values. */
function percentile(sorted: number[], share: number): number {
	const at = (sorted.length - 1) * share;
	const below = sorted[Math.floor(at)] ?? 0;
	const above = sorted[Math.ceil(at)] ?? below;
	return below + (above - below) * (at - Math.floor(at));
}

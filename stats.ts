import type { Outcome } from "./outcomes";
import {
	type MergeFailure,
	REMOVE_REASONS,
	type RemoveReason,
} from "./worktree";

/** How a group of ended tasks went, summed. */
export interface Tally {
	merged: number;
	removed: number;
	/** Of `merged`, those that landed without a person answering a question. */
	clean: number;
	/** Over every task in the group, merged and removed alike. */
	questionRounds: number;
	reviewRounds: number;
	failedMerges: number;
	/** Questions that offered the agent's pick and were answered with a choice. */
	picksAsked: number;
	/** Of `picksAsked`, those answered with another choice. */
	picksOverturned: number;
	/** Of `picksAsked`, those answered with the agent's choice and words added. */
	picksAmended: number;
	/** Tasks whose time waiting on a person was kept; older ones were not. */
	timed: number;
	/** Of the `timed` tasks, how long they waited on a person, in milliseconds. */
	waitedMs: number;
	/** Of the `timed` tasks, how long they took from add to end, in milliseconds. */
	spentMs: number;
	/** Failed merges by why, where it was kept. */
	failedBy: Record<MergeFailure, number>;
	/** Removed tasks by why; `unsaid` for one removed without `--reason`, or before it was kept. */
	removedFor: Record<RemoveReason | "unsaid", number>;
}

/** What the Stats page shows: how tasks ended, week by week and by who did them. */
export interface Stats {
	/** Each week of the period, oldest first, those with nothing ended among them. */
	weeks: ({ start: string } & Tally)[];
	/**
	 * The as many weeks before the period, summed, to compare it with; null
	 * for all time, which has nothing before it.
	 */
	previous: Tally | null;
	/** By the model that ended each task in the period, the most first; null for unknown. */
	models: ({ model: string | null } & Tally)[];
	/** By the main tree each task in the period was in, the most first. */
	projects: ({ project: string } & Tally)[];
	/**
	 * By each system a task in the period touched, the most first: a task
	 * counts in each of its systems, and in `null` when it touched none or
	 * ended before systems were kept.
	 */
	systems: ({ system: string | null } & Tally)[];
	/** When the first outcome was written, the start of what there is to show. */
	since: string | null;
}

export interface SummarizeOptions {
	/** How many weeks to sum, this one among them; null for all time. */
	weeks?: number | null;
	now?: Date;
}

/**
 * Sums the outcomes written so far for the page, over the last `weeks`. A
 * part, which lands on its caller's branch rather than trunk, is left out: it
 * is a piece of a task that is counted when its caller ends.
 */
export function summarize(
	outcomes: Outcome[],
	{ weeks = 12, now = new Date() }: SummarizeOptions = {},
): Stats {
	const tasks = outcomes.filter((each) => !each.base.startsWith("task/"));
	const since = tasks[0]?.endedAt ?? null;
	const thisWeek = weekOf(now);
	// All time runs from the week the first task ended, or this one alone.
	const length =
		weeks ??
		(since === null
			? 1
			: Math.round(
					(thisWeek.getTime() - weekOf(new Date(since)).getTime()) / WEEK,
				) + 1);
	const first = new Date(thisWeek.getTime() - (length - 1) * WEEK);
	const inPeriod = tasks.filter(
		(each) => weekOf(new Date(each.endedAt)) >= first,
	);
	const before = new Date(first.getTime() - length * WEEK);
	return {
		weeks: Array.from({ length }, (_, index) => {
			const start = new Date(first.getTime() + index * WEEK);
			return {
				start: start.toISOString().slice(0, 10),
				...tally(
					inPeriod.filter(
						(each) =>
							weekOf(new Date(each.endedAt)).getTime() === start.getTime(),
					),
				),
			};
		}),
		previous:
			weeks === null
				? null
				: tally(
						tasks.filter((each) => {
							const week = weekOf(new Date(each.endedAt));
							return week >= before && week < first;
						}),
					),
		models: grouped(inPeriod, (each) => each.model).map(([model, tally]) => ({
			model,
			...tally,
		})),
		projects: grouped(inPeriod, (each) => each.project).map(
			([project, tally]) => ({ project, ...tally }),
		),
		systems: grouped(
			inPeriod.flatMap((each) =>
				each.systems?.length
					? each.systems.map((system) => ({ ...each, systems: [system] }))
					: [{ ...each, systems: [] }],
			),
			(each) => each.systems?.[0] ?? null,
		).map(([system, tally]) => ({ system, ...tally })),
		since,
	};
}

/** A week in milliseconds: weeks start on a UTC Monday, so none is short. */
const WEEK = 7 * 24 * 60 * 60 * 1000;

function tally(outcomes: Outcome[]): Tally {
	const merged = outcomes.filter((each) => each.ended === "merged");
	const timed = outcomes.filter((each) => each.waitedMs !== undefined);
	const removedFor = blank(["unsaid", ...REMOVE_REASONS]);
	for (const each of outcomes) {
		if (each.ended === "removed") {
			removedFor[each.removedFor ?? "unsaid"]++;
		}
	}
	const failedBy = blank(MERGE_FAILURES);
	for (const each of outcomes) {
		for (const reason of MERGE_FAILURES) {
			failedBy[reason] += each.failedMergesBy?.[reason] ?? 0;
		}
	}
	return {
		merged: merged.length,
		removed: outcomes.length - merged.length,
		clean: merged.filter((each) => each.questionRounds === 0).length,
		questionRounds: sum(outcomes, (each) => each.questionRounds),
		reviewRounds: sum(outcomes, (each) => each.reviewRounds),
		failedMerges: sum(outcomes, (each) => each.failedMerges),
		picksAsked: sum(outcomes, (each) => each.picksAsked ?? 0),
		picksOverturned: sum(outcomes, (each) => each.picksOverturned ?? 0),
		picksAmended: sum(outcomes, (each) => each.picksAmended ?? 0),
		timed: timed.length,
		waitedMs: sum(timed, (each) => each.waitedMs ?? 0),
		spentMs: sum(
			timed,
			(each) => Date.parse(each.endedAt) - Date.parse(each.startedAt),
		),
		failedBy,
		removedFor,
	};
}

/** Tallies added up, as for the weeks of a period. */
export function combine(tallies: Tally[]): Tally {
	const total = tally([]);
	for (const each of tallies) {
		for (const key of SUMMED) {
			total[key] += each[key];
		}
		for (const reason of MERGE_FAILURES) {
			total.failedBy[reason] += each.failedBy[reason];
		}
		for (const reason of ["unsaid", ...REMOVE_REASONS] as const) {
			total.removedFor[reason] += each.removedFor[reason];
		}
	}
	return total;
}

/** Every count in a tally that adds up as a plain number. */
const SUMMED = [
	"merged",
	"removed",
	"clean",
	"questionRounds",
	"reviewRounds",
	"failedMerges",
	"picksAsked",
	"picksOverturned",
	"picksAmended",
	"timed",
	"waitedMs",
	"spentMs",
] as const;

const MERGE_FAILURES: MergeFailure[] = [
	"conflict",
	"tests_failed",
	"merge_failed",
];

/** A count of 0 for each of `keys`. */
function blank<K extends string>(keys: readonly K[]): Record<K, number> {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function grouped<K>(
	outcomes: Outcome[],
	key: (outcome: Outcome) => K,
): [K, Tally][] {
	const groups = Map.groupBy(outcomes, key);
	return [...groups]
		.sort(([, one], [, other]) => other.length - one.length)
		.map(([each, members]) => [each, tally(members)]);
}

function sum(outcomes: Outcome[], count: (outcome: Outcome) => number): number {
	return outcomes.reduce((total, each) => total + count(each), 0);
}

/** The Monday, UTC, that starts the week `at` falls in. */
function weekOf(at: Date): Date {
	const start = new Date(
		Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
	);
	start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
	return start;
}

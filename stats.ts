import type { Outcome } from "./outcomes";

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
		since,
	};
}

/** A week in milliseconds: weeks start on a UTC Monday, so none is short. */
const WEEK = 7 * 24 * 60 * 60 * 1000;

function tally(outcomes: Outcome[]): Tally {
	const merged = outcomes.filter((each) => each.ended === "merged");
	return {
		merged: merged.length,
		removed: outcomes.length - merged.length,
		clean: merged.filter((each) => each.questionRounds === 0).length,
		questionRounds: sum(outcomes, (each) => each.questionRounds),
		reviewRounds: sum(outcomes, (each) => each.reviewRounds),
		failedMerges: sum(outcomes, (each) => each.failedMerges),
	};
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

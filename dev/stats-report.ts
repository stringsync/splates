import { Dispatcher, type Eventful } from "webappwiz/events";
import { combine, type PeriodId, type Stats, type Tally } from "../stats";
import { type Advice, advise, decimal, percent } from "./stats-advice";

export { decimal, percent };

export type StatsReportEvents = { changed: undefined };

/** Where the summary comes from: `arbor dev`, or a test's own. */
export interface StatsSource {
	stats(period: PeriodId): Promise<Stats>;
}

/** A span of time the page can look at, as its control names it. */
export interface Period {
	id: PeriodId;
	label: string;
	/** How a sentence names it, as in "the day before"; null for all time. */
	span: string | null;
}

/** What the period control offers, shortest first. */
export const PERIODS: Period[] = [
	{ id: "6h", label: "6 hours", span: "6 hours" },
	{ id: "1d", label: "1 day", span: "day" },
	{ id: "3d", label: "3 days", span: "3 days" },
	{ id: "7d", label: "7 days", span: "7 days" },
	{ id: "all", label: "All time", span: null },
];

/** A y-axis: where it tops out, and the values it marks, from 0 up. */
export interface Axis {
	max: number;
	ticks: { at: number; label: string }[];
}

/** One headline figure over the period, and over the as long a span before. */
export interface Tile {
	label: string;
	/** What it measures, for a reader new to the page. */
	hint: string;
	/** Shown as is: `12`, `54%`, `0.8`; null with nothing ended to measure. */
	now: string | null;
	was: string | null;
}

/** One bar of the trend, for its height and its tooltip. */
export interface Bucket {
	start: string;
	/** When it starts, as a person reads it: `Week of 2026-10-12`, `Tue 3:00 PM`. */
	label: string;
	ended: number;
	/** Question rounds over every task ended in it; null when none did. */
	questionsPerTask: number | null;
	/** Of the tasks merged in it, the share no question held up; null when none merged. */
	cleanShare: number | null;
}

/** A model or project, with the same figures as the tiles over the period. */
export interface Row {
	name: string;
	ended: number;
	cleanShare: number | null;
	questionsPerTask: number | null;
	reviewsPerTask: number | null;
	failedMerges: number;
	removedShare: number | null;
	/** Of the questions offering the agent's pick, the share you answered otherwise. */
	overturnedShare: number | null;
}

/**
 * What the Stats page shows of how tasks ended: whether questions are getting
 * rarer, bar by bar, by model and by project. Loads once, and again on `refresh`.
 */
export class StatsReport implements Eventful<StatsReportEvents> {
	private readonly dispatcher = new Dispatcher<StatsReportEvents>();
	readonly events = this.dispatcher.events;

	stats: Stats | null = null;
	/** Why the last load failed, until one succeeds. */
	error: string | null = null;
	/** What the page looks at: 7 days, until the person picks another. */
	period: Period = PERIODS[3] as Period;
	/** The last load asked for, so an earlier one landing late is dropped. */
	private asked = 0;

	constructor(private readonly source: StatsSource) {}

	/** Looks at `period` instead, loading what it covers. */
	choose(period: Period): Promise<void> {
		this.period = period;
		this.dispatcher.dispatch("changed");
		return this.refresh();
	}

	async refresh(): Promise<void> {
		const asked = ++this.asked;
		try {
			const stats = await this.source.stats(this.period.id);
			if (asked !== this.asked) {
				return;
			}
			this.stats = stats;
			this.error = null;
		} catch (error) {
			if (asked !== this.asked) {
				return;
			}
			this.error = error instanceof Error ? error.message : String(error);
		}
		this.dispatcher.dispatch("changed");
	}

	/** Whether any task has ended since outcomes were first written. */
	get empty(): boolean {
		return this.stats !== null && this.stats.since === null;
	}

	get tiles(): Tile[] {
		const recent = combine(this.stats?.buckets ?? []);
		const before = this.stats?.previous ?? null;
		const figure = (
			of: (tally: Tally) => number | null,
			shown: (value: number) => string,
		) => {
			// A span before outcomes were written reads as nothing ended, which
			// says nothing about them, so they compare with nothing.
			const now = of(recent);
			const was =
				before === null || before.merged + before.removed === 0
					? null
					: of(before);
			return {
				now: now === null ? null : shown(now),
				was: was === null ? null : shown(was),
			};
		};
		return [
			{
				label: "Tasks ended",
				hint: "Merged or removed",
				...figure((tally) => tally.merged + tally.removed, String),
			},
			{
				label: "Merged without questions",
				hint: "Of the tasks merged, those no question held up",
				...figure(cleanShare, percent),
			},
			{
				label: "Questions per task",
				hint: "Times a task was handed to you with questions",
				...figure(questionsPerTask, decimal),
			},
			{
				label: "Removed",
				hint: "Of the tasks ended, those thrown away",
				...figure(removedShare, percent),
			},
		];
	}

	get buckets(): Bucket[] {
		const weekly = this.period.id === "all";
		return (this.stats?.buckets ?? []).map((bucket) => ({
			start: bucket.start,
			label: weekly
				? `Week of ${bucket.start.slice(0, 10)}`
				: new Date(bucket.start).toLocaleString(undefined, {
						weekday: "short",
						hour: "numeric",
						minute: "2-digit",
					}),
			ended: bucket.merged + bucket.removed,
			questionsPerTask: questionsPerTask(bucket),
			cleanShare: cleanShare(bucket),
		}));
	}

	/** The y-axis for questions per task: a round number above the highest bar. */
	get questionsAxis(): Axis {
		return axis(
			Math.max(
				0,
				...this.buckets.map((bucket) => bucket.questionsPerTask ?? 0),
			),
		);
	}

	/** The y-axis for a share: always 0% to 100%, so bars compare at a glance. */
	get shareAxis(): Axis {
		return {
			max: 1,
			ticks: [0, 0.5, 1].map((at) => ({ at, label: percent(at) })),
		};
	}

	/** What the period says to change, a card a figure. */
	get advice(): Advice[] {
		return advise({
			period: combine(this.stats?.buckets ?? []),
			previous: this.stats?.previous ?? null,
			systems: (this.stats?.systems ?? []).map(({ system, ...tally }) => ({
				system,
				tally,
			})),
			span: this.period.span ?? this.period.label,
		});
	}

	/** By system, a task counting in each it touched; "No system" for none. */
	get systems(): Row[] {
		return (this.stats?.systems ?? []).map((each) =>
			row(each.system === null ? "No system" : `#${each.system}`, each),
		);
	}

	get models(): Row[] {
		return (this.stats?.models ?? []).map((each) =>
			row(each.model ?? "Unknown", each),
		);
	}

	get projects(): Row[] {
		return (this.stats?.projects ?? []).map((each) =>
			row(each.project.split("/").filter(Boolean).at(-1) ?? each.project, each),
		);
	}
}

/**
 * An axis from 0 to the first round number at or above `top`, 1, 2 or 5
 * times a power of ten, marked at 0, halfway and the top.
 */
export function axis(top: number): Axis {
	const power = top <= 0 ? 1 : 10 ** Math.floor(Math.log10(top));
	const step = [1, 2, 5, 10].find((each) => each * power >= top) ?? 10;
	const max = step * power;
	return {
		max,
		// Exact, as `0.25`, where the bars' own figures round to one place.
		ticks: [0, max / 2, max].map((at) => ({
			at,
			label: String(Number(at.toFixed(4))),
		})),
	};
}

function row(name: string, tally: Tally): Row {
	const ended = tally.merged + tally.removed;
	return {
		name,
		ended,
		cleanShare: cleanShare(tally),
		questionsPerTask: questionsPerTask(tally),
		reviewsPerTask: ended === 0 ? null : tally.reviewRounds / ended,
		failedMerges: tally.failedMerges,
		removedShare: removedShare(tally),
		overturnedShare:
			tally.picksAsked === 0 ? null : tally.picksOverturned / tally.picksAsked,
	};
}

function cleanShare(tally: Tally): number | null {
	return tally.merged === 0 ? null : tally.clean / tally.merged;
}

function questionsPerTask(tally: Tally): number | null {
	const ended = tally.merged + tally.removed;
	return ended === 0 ? null : tally.questionRounds / ended;
}

function removedShare(tally: Tally): number | null {
	const ended = tally.merged + tally.removed;
	return ended === 0 ? null : tally.removed / ended;
}

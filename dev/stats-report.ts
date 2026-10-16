import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	combine,
	type PeriodId,
	type Stats,
	type Tally,
	type WorkedFrom,
} from "../stats";
import { type DecisionRates, decisionRates } from "./decision-rates";
import {
	type Advice,
	type AdviceId,
	advise,
	decimal,
	percent,
} from "./stats-advice";

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

/**
 * The cards that may lead the page, most worth acting on first: those backing
 * what the person said they would do after reading it (let agents decide
 * what they ask, write down what one system draws, and check whether a
 * change helped). The rest always fold away.
 */
export const LEADS: AdviceId[] = ["picks", "assumptions", "hotspot", "course"];

/** How many cards lead the page at most. */
export const LEADING = 2;

/** A figure is charted bar by bar once this many bars have it. */
export const CHARTED = 3;

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
	/**
	 * The decision sizes the chart counts, null among them for calls with
	 * none; null for all of them, as it starts.
	 */
	shown: ReadonlySet<string | null> | null = null;
	/** The last load asked for, so an earlier one landing late is dropped. */
	private asked = 0;

	constructor(private readonly source: StatsSource) {}

	/** Looks at `period` instead, loading what it covers. */
	choose(period: Period): Promise<void> {
		this.period = period;
		this.dispatcher.dispatch("changed");
		return this.refresh();
	}

	/**
	 * Adds `size` to the sizes the chart counts, or takes it out, null being
	 * calls with none: picking one while all show counts it alone, and taking
	 * out the last one counts all again.
	 */
	toggleSize(size: string | null): void {
		const shown = new Set(this.shown ?? []);
		if (!shown.delete(size)) {
			shown.add(size);
		}
		this.shown = shown.size === 0 ? null : shown;
		this.dispatcher.dispatch("changed");
	}

	/** Counts every size on the chart again. */
	showAllSizes(): void {
		this.shown = null;
		this.dispatcher.dispatch("changed");
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

	/** How many tasks ended in the period, merged or removed. */
	get ended(): number {
		const tally = combine(this.stats?.buckets ?? []);
		return tally.merged + tally.removed;
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

	/**
	 * The cards worth acting on first: of `LEADS`, in its order, those with
	 * an act, at most `LEADING` of them.
	 */
	get lead(): Advice[] {
		const advice = this.advice;
		return LEADS.flatMap((id) =>
			advice.filter((each) => each.id === id && each.act !== null),
		).slice(0, LEADING);
	}

	/** Every card not leading, in `advise`'s order, folded away on the page. */
	get rest(): Advice[] {
		const lead = this.lead.map((each) => each.id);
		return this.advice.filter((each) => !lead.includes(each.id));
	}

	/** Whether `value` has enough bars to chart, `CHARTED` or more. */
	charted(value: (bucket: Bucket) => number | null): boolean {
		return (
			this.buckets.filter((bucket) => value(bucket) !== null).length >= CHARTED
		);
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
			each.system === null
				? row("No system", each)
				: { ...row(each.system, each), system: each.system },
		);
	}

	/** How many calls the person made against how many agents took off them; null until loaded. */
	get decisions(): DecisionRates | null {
		return this.stats === null
			? null
			: decisionRates(this.stats, this.period, this.buckets, this.shown);
	}

	get models(): Row[] {
		return (this.stats?.models ?? []).map((each) =>
			row(each.model ?? "Unknown", each),
		);
	}

	/** By where the person worked each task from; "No prompts" for none said from the page. */
	get devices(): Row[] {
		return (this.stats?.devices ?? []).map((each) =>
			row(
				each.device === null ? "No prompts" : DEVICE_NAMES[each.device],
				each,
			),
		);
	}

	get projects(): Row[] {
		return (this.stats?.projects ?? []).map((each) =>
			row(each.project.split("/").filter(Boolean).at(-1) ?? each.project, each),
		);
	}
}

/** What a device row reads as. */
const DEVICE_NAMES: Record<WorkedFrom, string> = {
	phone: "Phone",
	desktop: "Desktop",
	both: "Phone and desktop",
};

/** One bar of the trend, for its height and its tooltip. */
export interface Bucket {
	start: string;
	/** When it starts, as a person reads it: `Week of 2026-10-12`, `Tue 3:00 PM`. */
	label: string;
	ended: number;
	/** Question rounds over every task ended in it; null when none did. */
	questionsPerTask: number | null;
}

/** A model, device, project or system, with its figures over the period. */
export interface Row {
	name: string;
	/** The system the row is, shown as its chip; absent for a model, a project or no system. */
	system?: string;
	ended: number;
	questionsPerTask: number | null;
	reviewsPerTask: number | null;
	removedShare: number | null;
	/** Of the questions offering the agent's pick, the share you answered otherwise. */
	overturnedShare: number | null;
	/** Dollars a task cost, over those whose agent said; null when none did. */
	costPerTask: number | null;
	/** How long a task's agent worked, in milliseconds, over those with usage kept. */
	workedPerTask: number | null;
	/** Lines added and removed per task, over those whose diff size was kept. */
	linesPerTask: number | null;
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
		questionsPerTask: questionsPerTask(tally),
		reviewsPerTask: ended === 0 ? null : tally.reviewRounds / ended,
		removedShare: removedShare(tally),
		overturnedShare: overturnedShare(tally),
		costPerTask: tally.costed === 0 ? null : tally.cost / tally.costed,
		workedPerTask: tally.used === 0 ? null : tally.workedMs / tally.used,
		linesPerTask:
			tally.sized === 0
				? null
				: (tally.linesAdded + tally.linesRemoved) / tally.sized,
	};
}

function overturnedShare(tally: Tally): number | null {
	return tally.picksAsked === 0
		? null
		: tally.picksOverturned / tally.picksAsked;
}

function questionsPerTask(tally: Tally): number | null {
	const ended = tally.merged + tally.removed;
	return ended === 0 ? null : tally.questionRounds / ended;
}

function removedShare(tally: Tally): number | null {
	const ended = tally.merged + tally.removed;
	return ended === 0 ? null : tally.removed / ended;
}

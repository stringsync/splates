import {
	bucketOf,
	type Decided,
	type Stats,
} from "@stringsync/splates-server/stats/browser";
import { type Axis, axis, type Bucket, type Period } from "./stats-report";

/**
 * How many calls the person made, as a rate: its going down is the goal, as
 * fewer actions a minute is in a game played well by its units.
 */
export interface DecisionRates {
	/** What each rate is per: an hour over a day or less, a day over longer. */
	unit: "hour" | "day";
	byYou: Rate;
	/** Each bar of the period, oldest first, the rate over it alone. */
	bars: Bar[];
	/** The axis the line is drawn on, whichever sizes are shown. */
	axis: Axis;
	/**
	 * Every size in the period, `SIZES` in order, then any other word, then
	 * calls with none, shown or not, with its count over the period.
	 */
	sizes: { size: string | null; byYou: number }[];
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The rates `stats` holds for `period` over the sizes `shown`, its bars
 * labeled as `buckets` are.
 */
export function decisionRates(
	stats: Stats,
	period: Period,
	buckets: Bucket[],
	/** The sizes to count, null among them for calls with none; null for all. */
	shown: ReadonlySet<string | null> | null,
): DecisionRates {
	const unit = period.id === "6h" || period.id === "1d" ? "hour" : "day";
	const per = unit === "hour" ? HOUR : DAY;
	const bucket = bucketOf(period.id);
	// A stand-in server can leave any of these out.
	const { buckets: tallies = [], sizes = [] } = stats;
	const span = bucket * tallies.length;
	const picked = sizes.filter((each) => shown === null || shown.has(each.size));
	const add = (all: (Decided | null)[]): Decided =>
		all.reduce<Decided>(
			(sum, each) => ({
				decidedByYou: sum.decidedByYou + (each?.decidedByYou ?? 0),
			}),
			{ decidedByYou: 0 },
		);
	const total = add(picked);
	const earlier = add(picked.map((each) => each.previous));
	// A span before with no call is one before any were kept, and says
	// nothing of how the rate moved; nor does all time.
	const previous =
		stats.previous != null && earlier.decidedByYou > 0 ? earlier : null;
	const byYou: Rate = {
		count: total.decidedByYou,
		rate: span === 0 ? 0 : (total.decidedByYou / span) * per,
		before:
			previous === null || span === 0
				? null
				: (previous.decidedByYou / span) * per,
	};
	const barsOf = (of: Decided[][]): Bar[] =>
		tallies.map((each, index) => {
			const inBar = add(of.map((buckets) => buckets[index] ?? null));
			return {
				start: each.start,
				label: buckets[index]?.label ?? each.start,
				byYou: (inBar.decidedByYou / bucket) * per,
			};
		});
	const bars = barsOf(picked.map((each) => each.buckets));
	return {
		unit,
		byYou,
		bars,
		// Held to every size's lines, so a size alone shows its share of them.
		axis: highest(barsOf(sizes.map((each) => each.buckets))),
		sizes: sizes.map((each) => ({
			size: each.size,
			byYou: each.decidedByYou,
		})),
	};
}

/** The rate over one bar of the period. */
export interface Bar {
	start: string;
	label: string;
	byYou: number;
}

/** The calls over the period. */
export interface Rate {
	/** How many it made in the period. */
	count: number;
	/** Per `unit`, over the whole period. */
	rate: number;
	/** Per `unit`, over the as long a span before; null for all time, or a span with no call. */
	before: number | null;
}

/** An axis that holds the highest rate in `bars`. */
function highest(bars: Bar[]): Axis {
	return axis(Math.max(0, ...bars.map((each) => each.byYou)));
}

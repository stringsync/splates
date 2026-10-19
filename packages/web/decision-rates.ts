import { bucketOf, type Stats } from "@stringsync/splates-server/stats/browser";
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
	/** The axis the line is drawn on. */
	axis: Axis;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The rates `stats` holds for `period`, its bars labeled as `buckets` are. */
export function decisionRates(
	stats: Stats,
	period: Period,
	buckets: Bucket[],
): DecisionRates {
	const unit = period.id === "6h" || period.id === "1d" ? "hour" : "day";
	const per = unit === "hour" ? HOUR : DAY;
	const bucket = bucketOf(period.id);
	// A stand-in server can leave these out.
	const { buckets: tallies = [] } = stats;
	const span = bucket * tallies.length;
	const total = tallies.reduce((sum, each) => sum + each.decidedByYou, 0);
	// A span before with no call is one before any were kept, and says
	// nothing of how the rate moved; nor does all time.
	const earlier = stats.previous?.decidedByYou ?? 0;
	const byYou: Rate = {
		count: total,
		rate: span === 0 ? 0 : (total / span) * per,
		before: earlier === 0 || span === 0 ? null : (earlier / span) * per,
	};
	const bars = tallies.map((each, index) => ({
		start: each.start,
		label: buckets[index]?.label ?? each.start,
		byYou: (each.decidedByYou / bucket) * per,
	}));
	return { unit, byYou, bars, axis: highest(bars) };
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

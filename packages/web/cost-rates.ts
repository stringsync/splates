import type { Stats, Tally } from "@stringsync/splates-server/stats/browser";
import { type Axis, axis, type Bucket } from "./stats-report";

/**
 * What a task cost, in dollars, over the period and bar by bar: its going
 * down is the page's north star, as the same work done for less.
 */
export interface CostRates {
	perTask: CostRate;
	/** Each bar of the period, oldest first, the cost per task over it alone. */
	bars: CostBar[];
	/** The axis the line is drawn on. */
	axis: Axis;
}

/** The cost per task over the period. */
export interface CostRate {
	/** The tasks it is over: those ended in the period whose agent said what they cost. */
	tasks: number;
	/** Dollars per task; null when no task said. */
	cost: number | null;
	/** Dollars per task over the as long a span before; null for all time, or a span no task said. */
	before: number | null;
}

/** The cost per task over one bar of the period. */
export interface CostBar {
	start: string;
	label: string;
	tasks: number;
	/** Null when no task that ended in it said what it cost. */
	cost: number | null;
}

/** The cost per task `stats` holds, its bars labeled as `buckets` are. */
export function costRates(stats: Stats, buckets: Bucket[]): CostRates {
	// A stand-in server can leave these out.
	const { buckets: tallies = [], previous = null } = stats;
	const costed = tallies.reduce((sum, each) => sum + each.costed, 0);
	const cost = tallies.reduce((sum, each) => sum + each.cost, 0);
	const bars = tallies.map((each, index) => ({
		start: each.start,
		label: buckets[index]?.label ?? each.start,
		tasks: each.costed,
		cost: perTask(each),
	}));
	return {
		perTask: {
			tasks: costed,
			cost: costed === 0 ? null : cost / costed,
			before: previous === null ? null : perTask(previous),
		},
		bars,
		axis: axis(Math.max(0, ...bars.map((each) => each.cost ?? 0))),
	};
}

function perTask(tally: Tally): number | null {
	return tally.costed === 0 ? null : tally.cost / tally.costed;
}

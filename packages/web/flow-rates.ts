import {
	bucketOf,
	type Stats,
	type Tally,
} from "@stringsync/splates-server/stats/browser";
import { type Axis, axis, type Bucket, type Period } from "./stats-report";

/** The flow `stats` holds for `period`, its bars labeled as `buckets` are. */
export function flowRates(
	stats: Stats,
	period: Period,
	buckets: Bucket[],
): FlowRates {
	const unit = period.id === "6h" || period.id === "1d" ? "hour" : "day";
	const per = unit === "hour" ? HOUR : DAY;
	const bucket = bucketOf(period.id);
	// A stand-in server can leave these out.
	const { buckets: tallies = [], previous = null } = stats;
	const span = bucket * tallies.length;
	const total = (key: keyof Tally) =>
		tallies.reduce((sum, each) => sum + (each[key] as number), 0);
	const closed = total("merged") + total("removed");
	// A span before with nothing closed says nothing of how the rate moved.
	const closedBefore =
		previous === null ? 0 : previous.merged + previous.removed;
	const bars = tallies.map((each, index) => ({
		start: each.start,
		label: buckets[index]?.label ?? each.start,
		closed: ((each.merged + each.removed) / bucket) * per,
		merges: each.mergeTimed,
		queuedMinutes: average(each.mergeQueuedMs, each.mergeTimed, MINUTE),
		ranMinutes: average(each.mergeRanMs, each.mergeTimed, MINUTE),
	}));
	const timed = total("timed");
	const merges = total("mergeTimed");
	return {
		unit,
		closed: {
			count: closed,
			value: span === 0 ? null : (closed / span) * per,
			before:
				closedBefore === 0 || span === 0 ? null : (closedBefore / span) * per,
		},
		toClose: {
			count: timed,
			value: average(total("spentMs"), timed),
			before:
				previous === null ? null : average(previous.spentMs, previous.timed),
		},
		queued: {
			count: merges,
			value: average(total("mergeQueuedMs"), merges),
			before:
				previous === null
					? null
					: average(previous.mergeQueuedMs, previous.mergeTimed),
		},
		ran: {
			count: merges,
			value: average(total("mergeRanMs"), merges),
			before:
				previous === null
					? null
					: average(previous.mergeRanMs, previous.mergeTimed),
		},
		bars,
		closedAxis: axis(Math.max(0, ...bars.map((each) => each.closed))),
		mergeAxis: axis(
			Math.max(
				0,
				...bars.map((each) =>
					Math.max(each.queuedMinutes ?? 0, each.ranMinutes ?? 0),
				),
			),
		),
	};
}

/**
 * How fast work goes through: how many tasks close, how long each takes from
 * add to close, and how long a landing merge waits its turn for the
 * premerge lock and then runs.
 */
export interface FlowRates {
	/** What `closed` is per: an hour over a day or less, a day over longer. */
	unit: "hour" | "day";
	/** Tasks merged or removed, per `unit`. */
	closed: Figure;
	/** Milliseconds from add to close, on average over the tasks timed. */
	toClose: Figure;
	/** Milliseconds a landing merge waited for the premerge lock, on average. */
	queued: Figure;
	/** Milliseconds a landing merge ran once the lock was its, on average. */
	ran: Figure;
	/** Each bar of the period, oldest first, its figures over it alone. */
	bars: FlowBar[];
	/** The axis tasks closed per `unit` is drawn on. */
	closedAxis: Axis;
	/** The axis merge times are drawn on, in minutes. */
	mergeAxis: Axis;
}

/** One figure over the period. */
export interface Figure {
	/** The tasks, or merges, it is over. */
	count: number;
	/** Null when there were none to say. */
	value: number | null;
	/** Over the as long a span before; null for all time, or a span with none to say. */
	before: number | null;
}

/** The figures over one bar of the period. */
export interface FlowBar {
	start: string;
	label: string;
	/** Tasks closed per `unit`. */
	closed: number;
	/** Landing merges timed in it. */
	merges: number;
	/** Average minutes queued and ran; null when no merge timed landed in it. */
	queuedMinutes: number | null;
	ranMinutes: number | null;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `sum` over `count`, in `per`s; null over none. */
function average(sum: number, count: number, per = 1): number | null {
	return count === 0 ? null : sum / count / per;
}

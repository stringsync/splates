import { describe, expect, it } from "bun:test";
import { combine, type Stats } from "@stringsync/splates-server/stats/browser";
import { flowRates } from "./flow-rates";
import { PERIODS, type Period } from "./stats-report";

describe("flowRates", () => {
	it("gives tasks closed per day, time to close, and how long merges queued and ran", () => {
		const rates = flowRates(stats, week, []);

		expect(rates.unit).toBe("day");
		expect(rates.closed).toEqual({ count: 21, value: 3, before: 4 });
		expect(rates.toClose).toEqual({
			count: 20,
			value: 2 * HOUR,
			before: 4 * HOUR,
		});
		expect(rates.queued).toEqual({
			count: 4,
			value: 30_000,
			before: 60_000,
		});
		expect(rates.ran).toEqual({ count: 4, value: 150_000, before: 0 });
		// 21 in a quarter of a day is 84 a day.
		expect(rates.bars.at(-1)).toMatchObject({
			closed: 84,
			merges: 4,
			queuedMinutes: 0.5,
			ranMinutes: 2.5,
		});
		expect(rates.bars[0]).toMatchObject({
			queuedMinutes: null,
			ranMinutes: null,
		});
		expect(rates.mergeAxis.max).toBe(5);
	});

	it("says nothing of how the rates moved when the span before closed nothing", () => {
		const rates = flowRates({ ...stats, previous: combine([]) }, week, []);

		expect(rates.closed.before).toBeNull();
		expect(rates.queued.before).toBeNull();
	});
});

const HOUR = 60 * 60 * 1000;

const week = PERIODS[3] as Period;

/** 28 empty bars of 6 hours, but for what `last` puts in the last. */
function bars<T>(last: T, none: T): T[] {
	return Array.from({ length: 28 }, (_, index) => (index === 27 ? last : none));
}

/** A week whose last bar holds every task. */
const stats: Stats = {
	buckets: bars(
		{
			start: "bar 27",
			...combine([]),
			merged: 20,
			removed: 1,
			timed: 20,
			spentMs: 40 * HOUR,
			mergeTimed: 4,
			mergeQueuedMs: 120_000,
			mergeRanMs: 600_000,
		},
		{ start: "bar", ...combine([]) },
	).map((each, index) => ({ ...each, start: `bar ${index}` })),
	previous: {
		...combine([]),
		merged: 28,
		timed: 2,
		spentMs: 8 * HOUR,
		mergeTimed: 1,
		mergeQueuedMs: 60_000,
		mergeRanMs: 0,
	},
	models: [],
	devices: [],
	projects: [],
	since: null,
	skill: [],
	baselines: [],
};

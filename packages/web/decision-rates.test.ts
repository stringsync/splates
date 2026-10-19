import { describe, expect, it } from "bun:test";
import { combine, type Stats } from "@stringsync/splates-server/stats/browser";
import { decisionRates } from "./decision-rates";
import { PERIODS, type Period } from "./stats-report";

describe("decisionRates", () => {
	it("gives the person's calls per day over 7 days, and per day over each 6-hour bar", () => {
		const rates = decisionRates(stats, week, []);

		expect(rates.unit).toBe("day");
		expect(rates.byYou).toEqual({ count: 21, rate: 3, before: 4 });
		// 21 in a quarter of a day is 84 a day.
		expect(rates.bars.at(-1)).toMatchObject({ byYou: 84 });
		expect(rates.axis.max).toBe(100);
	});

	it("says nothing of how the rate moved when the span before has no call", () => {
		const rates = decisionRates({ ...stats, previous: combine([]) }, week, []);

		expect(rates.byYou.before).toBeNull();
	});
});

const week = PERIODS[3] as Period;

/** 28 empty bars of 6 hours, but for what `last` puts in the last. */
function bars<T>(last: T, none: T): T[] {
	return Array.from({ length: 28 }, (_, index) => (index === 27 ? last : none));
}

/** A week whose last bar holds every call. */
const stats: Stats = {
	buckets: bars(
		{ start: "bar 27", ...combine([]), decidedByYou: 21 },
		{ start: "bar", ...combine([]) },
	).map((each, index) => ({ ...each, start: `bar ${index}` })),
	previous: { ...combine([]), decidedByYou: 28 },
	models: [],
	devices: [],
	projects: [],
	since: null,
	skill: [],
	baselines: [],
};

import { describe, expect, it } from "bun:test";
import { combine, type Stats } from "@stringsync/splates-server/stats/browser";
import { costRates } from "./cost-rates";

describe("costRates", () => {
	it("gives what a task cost over the period, over the span before, and bar by bar", () => {
		const rates = costRates(stats, []);

		// $6 over 4 costed tasks; $10 over 5 the span before.
		expect(rates.perTask).toEqual({ tasks: 4, cost: 1.5, before: 2 });
		expect(rates.bars.map((each) => each.cost)).toEqual([1, null, 2]);
		expect(rates.axis.max).toBe(2);
	});

	it("has no figure when no task said what it cost, nor one before for all time", () => {
		const rates = costRates(
			{ ...stats, buckets: [{ start: "bar", ...combine([]) }], previous: null },
			[],
		);

		expect(rates.perTask).toEqual({ tasks: 0, cost: null, before: null });
	});
});

const stats: Stats = {
	buckets: [
		{ start: "bar 0", ...combine([]), costed: 2, cost: 2 },
		{ start: "bar 1", ...combine([]) },
		{ start: "bar 2", ...combine([]), costed: 2, cost: 4 },
	],
	previous: { ...combine([]), costed: 5, cost: 10 },
	models: [],
	devices: [],
	projects: [],
	since: null,
	skill: [],
	baselines: [],
};

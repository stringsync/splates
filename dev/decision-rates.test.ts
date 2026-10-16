import { describe, expect, it } from "bun:test";
import { combine, type Stats } from "../stats";
import { decisionRates } from "./decision-rates";
import { PERIODS, type Period } from "./stats-report";

describe("decisionRates", () => {
	it("gives each side's calls per day over 7 days, and per day over each 6-hour bar", () => {
		const rates = decisionRates(stats, week, [], null);

		expect(rates.unit).toBe("day");
		expect(rates.byYou).toEqual({ count: 7, rate: 1, before: 2 });
		expect(rates.byAgents).toEqual({ count: 14, rate: 2, before: 1 });
		// 7 in a quarter of a day is 28 a day.
		expect(rates.bars.at(-1)).toMatchObject({ byYou: 28, byAgents: 56 });
		expect(rates.axis.max).toBe(100);
		expect(rates.systems).toEqual([
			{ system: null, byYou: 2, byAgents: 3 },
			{ system: "mixer", byYou: 1, byAgents: 0 },
		]);
	});

	it("counts only the sizes shown, on the axis every size needs", () => {
		const rates = decisionRates(stats, week, [], new Set(["large"]));

		expect(rates.byYou).toEqual({ count: 7, rate: 1, before: 2 });
		expect(rates.byAgents).toEqual({ count: 0, rate: 0, before: 0 });
		expect(rates.bars.at(-1)).toMatchObject({ byYou: 28, byAgents: 0 });
		expect(rates.axis.max).toBe(100);
		expect(rates.sizes.map((each) => each.size)).toEqual(["small", "large"]);
	});

	it("says nothing of how the rates moved when the span before has no call", () => {
		const rates = decisionRates(
			{
				...stats,
				sizes: stats.sizes.map((each) => ({
					...each,
					previous: { decidedByYou: 0, decidedByAgents: 0 },
				})),
			},
			week,
			[],
			null,
		);

		expect(rates.byYou.before).toBeNull();
	});
});

const week = PERIODS[3] as Period;

/** 28 empty bars of 6 hours, but for what `last` puts in the last. */
function bars<T>(last: T, none: T): T[] {
	return Array.from({ length: 28 }, (_, index) => (index === 27 ? last : none));
}

/** A week whose last bar holds every call, small ones the agents' alone. */
const stats: Stats = {
	buckets: bars(
		{ start: "bar 27", ...combine([]), decidedByYou: 7, decidedByAgents: 14 },
		{ start: "bar", ...combine([]) },
	).map((each, index) => ({ ...each, start: `bar ${index}` })),
	previous: { ...combine([]), decidedByYou: 14, decidedByAgents: 7 },
	models: [],
	devices: [],
	projects: [],
	sizes: [
		{
			size: "small",
			decidedByYou: 0,
			decidedByAgents: 14,
			buckets: bars(
				{ decidedByYou: 0, decidedByAgents: 14 },
				{ decidedByYou: 0, decidedByAgents: 0 },
			),
			previous: { decidedByYou: 0, decidedByAgents: 7 },
		},
		{
			size: "large",
			decidedByYou: 7,
			decidedByAgents: 0,
			buckets: bars(
				{ decidedByYou: 7, decidedByAgents: 0 },
				{ decidedByYou: 0, decidedByAgents: 0 },
			),
			previous: { decidedByYou: 14, decidedByAgents: 0 },
		},
	],
	systems: [
		{ system: "mixer", ...combine([]), decidedByYou: 1 },
		{ system: "docs", ...combine([]) },
		{ system: null, ...combine([]), decidedByYou: 2, decidedByAgents: 3 },
	],
	since: null,
	skill: [],
	baselines: [],
};

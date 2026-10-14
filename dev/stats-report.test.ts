import { describe, expect, it } from "bun:test";
import { combine, type PeriodId, type Stats, type Tally } from "../stats";
import {
	axis,
	PERIODS,
	type Period,
	StatsReport,
	type StatsSource,
} from "./stats-report";

/** A bar where nothing ended; a test fills in what it is about. */
function bar(start: string, changes: Partial<Tally> = {}) {
	return { start, ...combine([]), ...changes };
}

/** Answers with `stats`, or fails with `error` when given one; keeps what it was asked. */
class FakeSource implements StatsSource {
	readonly asked: PeriodId[] = [];

	constructor(
		private readonly answer: Stats | null,
		private readonly error = "unreachable",
	) {}

	async stats(period: PeriodId): Promise<Stats> {
		this.asked.push(period);
		if (this.answer === null) {
			throw new Error(this.error);
		}
		return this.answer;
	}
}

const stats: Stats = {
	buckets: [
		bar("2026-10-13T12:00:00.000Z", {
			merged: 3,
			removed: 1,
			clean: 3,
			questionRounds: 1,
		}),
		bar("2026-10-13T18:00:00.000Z"),
		bar("2026-10-14T00:00:00.000Z"),
		bar("2026-10-14T06:00:00.000Z", { merged: 1, clean: 0, questionRounds: 2 }),
	],
	models: [
		{ model: null, ...bar("", { merged: 2, removed: 2, reviewRounds: 2 }) },
	],
	previous: bar("", { merged: 6, clean: 1, questionRounds: 9 }),
	projects: [{ project: "/Users/me/webappwiz", ...bar("", { merged: 1 }) }],
	systems: [],
	since: "2026-08-25T10:00:00.000Z",
};

describe("StatsReport", () => {
	it("leads with the acts that stand out, in the order the person acts on them", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		// Questions per task fell from 1.5 to 0.6, so it leads alone.
		expect(report.ended).toBe(5);
		expect(report.lead.map((each) => each.id)).toEqual(["course"]);
		expect(report.rest.map((each) => each.id)).toEqual([
			"picks",
			"assumptions",
			"waiting",
			"hotspot",
			"failures",
			"removals",
		]);

		const busy = new StatsReport(
			new FakeSource({
				...stats,
				buckets: [
					bar("2026-10-12T00:00:00.000Z", {
						merged: 10,
						questionRounds: 20,
						picksAsked: 20,
						picksOverturned: 1,
						failedMerges: 6,
						failedBy: { conflict: 6, tests_failed: 0, merge_failed: 0 },
					}),
				],
				systems: [
					{ system: "ui", ...bar("", { merged: 5, questionRounds: 20 }) },
					{ system: "cli", ...bar("", { merged: 5, questionRounds: 0 }) },
				],
			}),
		);
		await busy.refresh();

		// Four cards have an act, but only two lead, and never Why merges failed.
		expect(busy.lead.map((each) => each.id)).toEqual(["picks", "hotspot"]);
		expect(busy.rest.map((each) => each.id)).toContain("failures");
	});

	it("charts a figure only once enough bars have it", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		// Two of the four bars ended a task, one short of charting.
		expect(report.charted((each) => each.questionsPerTask)).toBe(false);
		expect(
			report.charted((each) => (each.ended === 0 ? null : each.ended)),
		).toBe(false);
		expect(report.charted(() => 1)).toBe(true);
	});

	it("leaves a bar with nothing ended unmeasured, rather than zero", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		expect(report.buckets[1]).toMatchObject({
			start: "2026-10-13T18:00:00.000Z",
			ended: 0,
			questionsPerTask: null,
		});
		expect(report.buckets.at(-1)).toMatchObject({
			ended: 1,
			questionsPerTask: 2,
		});
	});

	it("names each model and project as a person reads it", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		expect(report.models).toEqual([
			{
				name: "Unknown",
				ended: 4,
				questionsPerTask: 0,
				reviewsPerTask: 0.5,
				removedShare: 0.5,
				overturnedShare: null,
			},
		]);
		expect(report.projects).toMatchObject([{ name: "webappwiz", ended: 1 }]);
	});

	it("says why a load failed, and is empty before any task has ended", async () => {
		const failing = new StatsReport(new FakeSource(null, "offline"));
		const fresh = new StatsReport(
			new FakeSource({
				buckets: [],
				previous: null,
				models: [],
				projects: [],
				systems: [],
				since: null,
			}),
		);

		await failing.refresh();
		await fresh.refresh();

		expect(failing.error).toBe("offline");
		expect(fresh.empty).toBe(true);
	});

	it("asks for the period picked, 7 days until one is", async () => {
		const source = new FakeSource(stats);
		const report = new StatsReport(source);

		await report.refresh();
		await report.choose(PERIODS.at(-1) as Period);

		expect(source.asked).toEqual(["7d", "all"]);
		expect(report.period.label).toBe("All time");
		expect(report.buckets[0]?.label).toBe("Week of 2026-10-13");
	});

	it("drops a load that lands after a later one was asked for", async () => {
		const slow = Promise.withResolvers<Stats>();
		const later = { ...stats, since: "later" };
		const answers = [slow.promise, Promise.resolve(later)];
		const report = new StatsReport({
			stats: () => answers.shift() as Promise<Stats>,
		});

		const first = report.refresh();
		await report.choose(PERIODS[0] as Period);
		slow.resolve(stats);
		await first;

		expect(report.stats?.since).toBe("later");
	});

	it("tops an axis at a round number at or above the highest bar", () => {
		const marks = (top: number) => {
			const { max, ticks } = axis(top);
			return [max, ...ticks.map((tick) => tick.label)];
		};

		expect(marks(0)).toEqual([1, "0", "0.5", "1"]);
		expect(marks(1.7)).toEqual([2, "0", "1", "2"]);
		expect(marks(2.4)).toEqual([5, "0", "2.5", "5"]);
		expect(marks(0.3)).toEqual([0.5, "0", "0.25", "0.5"]);
	});
});

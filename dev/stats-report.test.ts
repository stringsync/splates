import { describe, expect, it } from "bun:test";
import { combine, type Stats, type Tally } from "../stats";
import {
	axis,
	PERIODS,
	type Period,
	StatsReport,
	type StatsSource,
} from "./stats-report";

/** A week where nothing ended; a test fills in what it is about. */
function week(start: string, changes: Partial<Tally> = {}) {
	return { start, ...combine([]), ...changes };
}

/** Answers with `stats`, or fails with `error` when given one; keeps what it was asked. */
class FakeSource implements StatsSource {
	readonly asked: (number | null)[] = [];

	constructor(
		private readonly answer: Stats | null,
		private readonly error = "unreachable",
	) {}

	async stats(weeks: number | null): Promise<Stats> {
		this.asked.push(weeks);
		if (this.answer === null) {
			throw new Error(this.error);
		}
		return this.answer;
	}
}

const stats: Stats = {
	weeks: [
		week("2026-09-21", { merged: 3, removed: 1, clean: 3, questionRounds: 1 }),
		week("2026-09-28"),
		week("2026-10-05"),
		week("2026-10-12", { merged: 1, clean: 0, questionRounds: 2 }),
	],
	models: [
		{ model: null, ...week("", { merged: 2, removed: 2, reviewRounds: 2 }) },
	],
	previous: week("", { merged: 4, clean: 1, questionRounds: 6 }),
	projects: [{ project: "/Users/me/webappwiz", ...week("", { merged: 1 }) }],
	systems: [],
	since: "2026-08-25T10:00:00.000Z",
};

describe("StatsReport", () => {
	it("compares the period with the as many weeks before", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		expect(report.tiles).toMatchObject([
			{ label: "Tasks ended", now: "5", was: "4" },
			{ label: "Merged without questions", now: "75%", was: "25%" },
			{ label: "Questions per task", now: "0.6", was: "1.5" },
			{ label: "Removed", now: "20%", was: "0%" },
		]);
	});

	it("leaves a week with nothing ended unmeasured, rather than zero", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		expect(report.weeks[1]).toEqual({
			start: "2026-09-28",
			ended: 0,
			questionsPerTask: null,
			cleanShare: null,
		});
		expect(report.weeks.at(-1)).toMatchObject({
			ended: 1,
			questionsPerTask: 2,
			cleanShare: 0,
		});
	});

	it("names each model and project as a person reads it", async () => {
		const report = new StatsReport(new FakeSource(stats));

		await report.refresh();

		expect(report.models).toEqual([
			{
				name: "Unknown",
				ended: 4,
				cleanShare: 0,
				questionsPerTask: 0,
				reviewsPerTask: 0.5,
				failedMerges: 0,
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
				weeks: [],
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

	it("asks for the period picked, 12 weeks until one is", async () => {
		const source = new FakeSource(stats);
		const report = new StatsReport(source);

		await report.refresh();
		await report.choose(PERIODS.at(-1) as Period);

		expect(source.asked).toEqual([12, null]);
		expect(report.period.label).toBe("All time");
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

	it("tops an axis at a round number at or above the highest week", () => {
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

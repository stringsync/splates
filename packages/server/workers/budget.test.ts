import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { alertNotice, dollars, WorkerBudget } from "./budget";

describe("WorkerBudget", () => {
	it("holds made workers to $0.25/h, $5 a day and $75 a month by default", () => {
		const budget = WorkerBudget.memory(clock());

		expect(
			budget.standing().map(({ limit, dollars, spent, set }) => ({
				limit,
				dollars,
				spent,
				set,
			})),
		).toEqual([
			{ limit: "hour", dollars: 0.25, spent: 0, set: false },
			{ limit: "day", dollars: 5, spent: 0, set: false },
			{ limit: "month", dollars: 75, spent: 0, set: false },
		]);
	});

	it("counts what each made worker costs while it runs, at its list price", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);

		await budget.started("small-1", "small", 0.1);
		wall.advance(Duration.hrs(2));
		await budget.ended("small-1");
		wall.advance(Duration.hrs(1));

		const [, day, month] = budget.standing();
		expect(day?.spent).toBeCloseTo(0.2);
		expect(month?.spent).toBeCloseTo(0.2);
		expect(day?.estimate).toBe(true);
		expect(budget.rate()).toBe(0);
	});

	it("counts only the part of a life within the window", async () => {
		const wall = clock();
		wall.set(new Date(2026, 9, 17, 23, 0).getTime());
		const budget = WorkerBudget.memory(wall);

		await budget.started("small-1", "small", 1);
		wall.advance(Duration.hrs(3));

		const [, day, month] = budget.standing();
		expect(day?.spent).toBeCloseTo(2);
		expect(month?.spent).toBeCloseTo(3);
	});

	it("refuses a worker past the rate cap, counting those running", async () => {
		const budget = WorkerBudget.memory(clock());

		await budget.started("one", "small", 0.2);

		expect(budget.refusal(0.05)).toBeNull();
		expect(budget.refusal(0.1)).toBe("rate cap $0.25/h reached");
	});

	it("prices what a raise must add for a worker the rate cap refuses, to the cent", async () => {
		const budget = WorkerBudget.memory(clock());
		await budget.started("one", "small", 0.2);

		expect(budget.shortfall(0.05)).toBeNull();
		expect(budget.shortfall(0.11)).toEqual({ limit: "hour", dollars: 0.06 });
		await budget.raise("hour", 0.06);
		expect(budget.shortfall(0.11)).toBeNull();
	});

	it("refuses any worker, and stops those running, once the day's limit is spent", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.set("hour", 10);

		await budget.started("big", "big", 5);
		expect(budget.stopped()).toBeNull();
		wall.advance(Duration.hrs(1));

		expect(budget.refusal(0.01)).toBe("daily limit $5.00 reached");
		expect(budget.stopped()).toBe("daily limit $5.00 reached");
	});

	it("lets a raise add to a limit until it runs out", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);

		const raise = await budget.raise("hour", 0.25, Duration.hrs(1));
		expect(budget.standing()[0]).toMatchObject({ dollars: 0.5, raised: 0.25 });
		wall.advance(Duration.hrs(2));

		expect(budget.standing()[0]).toMatchObject({ dollars: 0.25, raised: 0 });
		expect(await budget.endRaise(raise.id)).toBe(false);
	});

	it("gives a limit set back to its default", async () => {
		const budget = WorkerBudget.memory(clock());

		await budget.set("month", 20);
		expect(budget.standing()[2]).toMatchObject({ dollars: 20, set: true });
		await budget.set("month", null);

		expect(budget.standing()[2]).toMatchObject({ dollars: 75, set: false });
	});

	it("alerts each tier once per window, its highest alone", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.set("hour", 10);
		await budget.set("month", 1000);
		await budget.started("big", "big", 1);

		wall.advance(Duration.hrs(4.1));
		expect(
			(await budget.alerts()).map(({ standing, tier }) => [
				standing.limit,
				tier,
			]),
		).toEqual([["day", 80]]);
		expect(await budget.alerts()).toEqual([]);
		wall.advance(Duration.hrs(0.5));
		expect((await budget.alerts()).map(({ tier }) => tier)).toEqual([90]);
		wall.advance(Duration.hrs(0.5));
		expect((await budget.alerts()).map(({ tier }) => tier)).toEqual([100]);
		expect(await budget.alerts()).toEqual([]);
	});

	it("keeps its limits, raises and ledger across a restart", async () => {
		const fs = new FakeFs();
		const wall = clock();
		const first = await WorkerBudget.open("/budget.json", fs, wall);
		await first.set("day", 2);
		await first.started("small-1", "small", 0.05);

		const second = await WorkerBudget.open("/budget.json", fs, wall);

		expect(second.standing()[1]?.dollars).toBe(2);
		expect(second.rate()).toBe(0.05);
	});

	it("keeps the conversations a stop held across a restart, until released", async () => {
		const fs = new FakeFs();
		const wall = clock();
		const first = await WorkerBudget.open("/budget.json", fs, wall);
		const one = { project: "/repo", conversation: "one" };
		await first.hold([one]);
		await first.hold([one, { project: "/repo", conversation: "two" }]);

		const second = await WorkerBudget.open("/budget.json", fs, wall);

		expect(second.held.map((each) => each.conversation)).toEqual([
			"one",
			"two",
		]);
		expect(await second.release()).toHaveLength(2);
		expect(second.held).toEqual([]);
		expect((await WorkerBudget.open("/budget.json", fs, wall)).held).toEqual(
			[],
		);
	});
});

describe("alertNotice", () => {
	it("says the limit reached and what to do", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.set("hour", 10);
		await budget.started("big", "big", 6);
		wall.advance(Duration.hrs(1));
		const [alert] = await budget.alerts();

		const notice = alertNotice(alert ?? fail());

		expect(notice.title).toBe("Workers: today's $5.00 reached");
		expect(notice.body).toContain("splates budget raise");
	});
});

describe("dollars", () => {
	it("shows cents, and a tenth of a cent only when there is one", () => {
		expect(dollars(0.25)).toBe("$0.25");
		expect(dollars(0.05)).toBe("$0.05");
		expect(dollars(0.0125)).toBe("$0.013");
		expect(dollars(75)).toBe("$75.00");
	});
});

/** A clock at 10:00 on 17 October 2026, local time, mid-day and mid-month. */
function clock(): FakeWallClock {
	const wall = new FakeWallClock();
	wall.set(new Date(2026, 9, 17, 10, 0).getTime());
	return wall;
}

function fail(): never {
	throw new Error("expected an alert");
}

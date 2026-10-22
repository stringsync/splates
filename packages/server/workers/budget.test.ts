import { describe, expect, it } from "bun:test";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { FsStorage } from "../storage";
import { WorkerBudget, type WorkerBudgetFile } from "./budget";

function budgetAt(fs: FakeFs) {
	return new FsStorage("/home", fs).document<WorkerBudgetFile>("budget.json");
}

describe("WorkerBudget", () => {
	it("holds made workers to $1/h, $15 a day and $200 a month by default", () => {
		const budget = WorkerBudget.memory(clock());

		expect(
			budget.standing().map(({ limit, dollars, spent, set }) => ({
				limit,
				dollars,
				spent,
				set,
			})),
		).toEqual([
			{ limit: "hour", dollars: 1, spent: 0, set: false },
			{ limit: "day", dollars: 15, spent: 0, set: false },
			{ limit: "month", dollars: 200, spent: 0, set: false },
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

		await budget.started("one", "small", 0.8);

		expect(budget.refusal(0.2)).toBeNull();
		expect(budget.refusal(0.3)).toBe("rate cap $1.00/h reached");
	});

	it("prices what a raise must add for a worker the rate cap refuses, to the cent", async () => {
		const budget = WorkerBudget.memory(clock());
		await budget.started("one", "small", 0.8);

		expect(budget.shortfall(0.2)).toBeNull();
		expect(budget.shortfall(0.26)).toEqual({ limit: "hour", dollars: 0.06 });
		await budget.raise("hour", 0.06);
		expect(budget.shortfall(0.26)).toBeNull();
	});

	it("refuses any worker, and stops those running, once the day's limit is spent", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.set("hour", 20);

		await budget.started("big", "big", 15);
		expect(budget.stopped()).toBeNull();
		wall.advance(Duration.hrs(1));

		expect(budget.refusal(0.01)).toBe("daily limit $15.00 reached");
		expect(budget.stopped()).toBe("daily limit $15.00 reached");
	});

	it("lets a raise add to a limit until it runs out", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);

		const raise = await budget.raise("hour", 0.25, Duration.hrs(1));
		expect(budget.standing()[0]).toMatchObject({ dollars: 1.25, raised: 0.25 });
		wall.advance(Duration.hrs(2));

		expect(budget.standing()[0]).toMatchObject({ dollars: 1, raised: 0 });
		expect(await budget.endRaise(raise.id)).toBe(false);
	});

	it("gives a limit set back to its default", async () => {
		const budget = WorkerBudget.memory(clock());

		await budget.set("month", 20);
		expect(budget.standing()[2]).toMatchObject({ dollars: 20, set: true });
		await budget.set("month", null);

		expect(budget.standing()[2]).toMatchObject({ dollars: 200, set: false });
	});

	it("gives every limit back to its default and forgets it was chosen", async () => {
		const budget = WorkerBudget.memory(clock());
		await budget.set("day", 8);
		await budget.raise("month", 10);

		await budget.unreview();

		expect(budget.reviewed).toBe(false);
		expect(budget.standing().map((each) => each.dollars)).toEqual([1, 15, 210]);
	});

	it("alerts each tier once per window, its highest alone", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.set("hour", 10);
		await budget.set("month", 1000);
		await budget.started("big", "big", 3);

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
		const first = await WorkerBudget.open(budgetAt(fs), wall);
		await first.set("day", 2);
		await first.started("small-1", "small", 0.05);

		const second = await WorkerBudget.open(budgetAt(fs), wall);

		expect(second.standing()[1]?.dollars).toBe(2);
		expect(second.rate()).toBe(0.05);
	});

	it("counts what another process wrote to its document since it opened, writing over none of it", async () => {
		const fs = new FakeFs();
		const wall = clock();
		const server = await WorkerBudget.open(budgetAt(fs), wall);
		const run = await WorkerBudget.open(budgetAt(fs), wall);
		await run.started("splates-run-1", "small", 0.05);

		await server.started("small-2", "small", 0.1);

		const after = await WorkerBudget.open(budgetAt(fs), wall);
		expect(after.rate()).toBeCloseTo(0.15);
		expect(server.rate()).toBeCloseTo(0.15);
	});

	it("keeps the conversations a stop held across a restart, until released", async () => {
		const fs = new FakeFs();
		const wall = clock();
		const first = await WorkerBudget.open(budgetAt(fs), wall);
		const one = { project: "/repo", conversation: "one" };
		await first.hold([one]);
		await first.hold([one, { project: "/repo", conversation: "two" }]);

		const second = await WorkerBudget.open(budgetAt(fs), wall);

		expect(second.held.map((each) => each.conversation)).toEqual([
			"one",
			"two",
		]);
		expect(await second.release()).toHaveLength(2);
		expect(second.held).toEqual([]);
		expect((await WorkerBudget.open(budgetAt(fs), wall)).held).toEqual([]);
	});
	it("splits made workers' spend by who held slots on them", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.started("made", "small", 1);

		await budget.ran([held("one", "a", "made"), held("two", "b", "home")]);
		wall.advance(Duration.mins(30));
		await budget.ran([]);
		wall.advance(Duration.mins(30));

		expect(budget.split("day")).toEqual([
			{ project: "/p", task: "a", dollars: 1, slotHours: 0.5, estimate: true },
		]);
	});

	it("says what one task cost between two times", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.started("made", "small", 1);
		const since = wall.now();
		await budget.ran([held("one", "a", "made"), held("two", "b", "made")]);
		wall.advance(Duration.mins(30));
		await budget.ran([held("one", "a", "made")]);
		wall.advance(Duration.mins(30));

		// The hour's dollar goes by slot-time: an hour of a's to half of b's.
		const spent = budget.spentOn("/p", "a", since, wall.now());
		expect(spent).toMatchObject({ task: "a", slotHours: 1, estimate: true });
		expect(spent?.dollars).toBeCloseTo(2 / 3);
		expect(budget.spentOn("/p", "c", since, wall.now())).toBeNull();
	});

	it("ends the runs on a worker that ends", async () => {
		const wall = clock();
		const budget = WorkerBudget.memory(wall);
		await budget.started("made", "small", 1);
		await budget.ran([held("one", "a", "made")]);
		wall.advance(Duration.mins(30));

		await budget.ended("made");
		wall.advance(Duration.hrs(2));

		expect(budget.split("month")).toEqual([
			{
				project: "/p",
				task: "a",
				dollars: 0.5,
				slotHours: 0.5,
				estimate: true,
			},
		]);
	});

	it("keeps the runs across a restart", async () => {
		const wall = clock();
		const fs = new FakeFs();
		const budget = await WorkerBudget.open(budgetAt(fs), wall);
		await budget.started("made", "small", 1);
		await budget.ran([held("one", "a", "made")]);
		wall.advance(Duration.hrs(1));

		const again = await WorkerBudget.open(budgetAt(fs), wall);

		expect(again.split("day")[0]).toMatchObject({ task: "a", dollars: 1 });
	});

	it("projects the month from what is spent and what runs now", async () => {
		const wall = new FakeWallClock();
		wall.set(new Date(2026, 9, 31, 22, 0).getTime());
		const budget = WorkerBudget.memory(wall);
		await budget.started("made", "small", 1);
		wall.advance(Duration.hrs(1));

		expect(budget.projected()).toBeCloseTo(2);
	});
});

function held(id: string, task: string, worker: string) {
	return { id, project: "/p", task, worker, uncapped: false };
}

/** A clock at 10:00 on 17 October 2026, local time, mid-day and mid-month. */
function clock(): FakeWallClock {
	const wall = new FakeWallClock();
	wall.set(new Date(2026, 9, 17, 10, 0).getTime());
	return wall;
}

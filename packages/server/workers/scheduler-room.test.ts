import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { type PoolWorker, Scheduler, type SlotRequest } from "./scheduler";

describe("Scheduler room", () => {
	let workers: PoolWorker[];
	let clock: FakeWallClock;
	let scheduler: Scheduler;
	/** How often the scheduler said its queue changed. */
	let changes: number;
	/** Whether the pool is paused, as the server's records say. */
	let paused: boolean;

	beforeEach(() => {
		workers = [worker("local")];
		clock = new FakeWallClock(1_000);
		paused = false;
		scheduler = new Scheduler(
			{ workers: () => workers, paused: () => paused },
			clock,
		);
		changes = 0;
		scheduler.events.on("changed", () => {
			changes += 1;
		});
	});

	it("counts the free slots of workers taking work, less those waiting", async () => {
		workers = [
			worker("local", { slots: 2 }),
			worker("asleep", { awake: false }),
			worker("draining", { draining: true }),
		];
		expect(scheduler.room()).toBe(2);

		await scheduler.take(request("a"));
		await scheduler.take(request("b", { uncapped: true }));
		expect(scheduler.room()).toBe(1);

		await scheduler.take(request("c"));
		void scheduler.take(request("d"));
		await Bun.sleep(0);
		expect(scheduler.room()).toBe(0);
	});

	it("has no room while paused, and says so once at each pause and resume", () => {
		paused = true;
		scheduler.poke();
		expect(changes).toBe(1);
		expect(scheduler.room()).toBe(0);

		scheduler.poke();
		expect(changes).toBe(1);

		paused = false;
		scheduler.poke();
		expect(changes).toBe(2);
		expect(scheduler.room()).toBe(1);
	});

	it("tells the queue when a worker joins while queued tasks want a slot", () => {
		workers = [worker("local", { slots: 0 })];
		scheduler.poke();
		expect(changes).toBe(0);

		scheduler.want("/repo", [request("#3")]);
		changes = 0;
		workers.push(worker("box"));
		scheduler.poke();
		expect(changes).toBe(1);
		expect(scheduler.room()).toBe(1);
	});

	it("lines up the queued tasks that find no room behind the agents waiting, placing none", async () => {
		await scheduler.take(request("a"));
		void scheduler.take(request("b"));
		await Bun.sleep(0);
		changes = 0;

		scheduler.want("/repo", [request("#3"), request("#4")]);
		clock.advance(Duration.mins(1));
		scheduler.want("/repo", [request("#3"), request("#4")]);
		scheduler.want("/repo", [request("#4")]);

		expect(changes).toBe(2);
		expect(scheduler.queue()).toEqual([
			expect.objectContaining({ id: "b", position: 1 }),
			expect.objectContaining({
				id: "#4",
				position: 2,
				since: 1_000,
				reason: "no free slot",
				queued: true,
			}),
		]);
		expect(scheduler.queue()[0]).not.toHaveProperty("queued");
		expect(scheduler.room()).toBe(0);

		scheduler.want("/repo", []);
		expect(scheduler.queue().map(({ id }) => id)).toEqual(["b"]);
	});
});

function worker(id: string, overrides: Partial<PoolWorker> = {}): PoolWorker {
	return {
		id,
		slots: 1,
		awake: true,
		...overrides,
	};
}

function request(
	id: string,
	overrides: Partial<SlotRequest> = {},
): SlotRequest {
	return {
		id,
		project: "/repo",
		task: id,
		agent: "claude",
		...overrides,
	};
}

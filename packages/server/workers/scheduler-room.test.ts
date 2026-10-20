import { describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { type PoolWorker, Scheduler, type SlotRequest } from "./scheduler";

describe("Scheduler room", () => {
	it("counts the free slots of workers taking work, less those waiting", async () => {
		const workers = [
			worker("local", { slots: 2 }),
			worker("asleep", { awake: false }),
			worker("draining", { draining: true }),
		];
		const scheduler = new Scheduler(
			{ workers: () => workers },
			new FakeWallClock(1_000),
		);
		expect(scheduler.room()).toBe(2);

		await scheduler.take(request("a"));
		await scheduler.take(request("b", { uncapped: true }));
		expect(scheduler.room()).toBe(1);

		await scheduler.take(request("c"));
		void scheduler.take(request("d"));
		await Bun.sleep(0);
		expect(scheduler.room()).toBe(0);
	});

	it("leaves the free slots to the queue when the agents waiting cannot use them", async () => {
		const workers = [
			worker("local", { slots: 2 }),
			worker("box", { runs: (agent) => agent === "claude" }),
		];
		const scheduler = new Scheduler(
			{ workers: () => workers },
			new FakeWallClock(1_000),
		);
		void scheduler.take(request("a", { platform: "linux" }));
		await scheduler.take(request("b"));
		await scheduler.take(request("c"));
		void scheduler.take(request("d", { agent: "codex" }));
		await Bun.sleep(0);
		expect(scheduler.queue().map(({ id }) => id)).toEqual(["a", "d"]);
		// "box" has a slot free, which neither waiting agent can take.
		expect(scheduler.room()).toBe(1);
	});

	it("tells the queue when a worker joins while queued tasks want a slot", () => {
		const workers = [worker("local", { slots: 0 })];
		const scheduler = new Scheduler(
			{ workers: () => workers },
			new FakeWallClock(1_000),
		);
		let changes = 0;
		scheduler.events.on("changed", () => {
			changes += 1;
		});
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
		const workers = [worker("local")];
		const clock = new FakeWallClock(1_000);
		const scheduler = new Scheduler({ workers: () => workers }, clock);
		let changes = 0;
		scheduler.events.on("changed", () => {
			changes += 1;
		});
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
		kind: id === "local" ? "local" : "registered",
		slots: 1,
		platform: "macos",
		awake: true,
		checkouts: true,
		runs: () => true,
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
		platform: null,
		agent: "claude",
		...overrides,
	};
}

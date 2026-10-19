import { describe, expect, it } from "bun:test";
import { FakeWallClock } from "webappwiz/time/testing";
import { type PoolWorker, Scheduler, type SlotRequest } from "./scheduler";

describe("Scheduler.room", () => {
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

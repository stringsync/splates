import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { GONE_AFTER, GoneWorkers } from "./gone";
import { type PoolWorker, Scheduler } from "./scheduler";

describe("GoneWorkers", () => {
	let timer: FakeTimer;
	let clock: FakeClock;
	let connected: Record<string, boolean>;
	let scheduler: Scheduler;
	let gone: GoneWorkers;

	beforeEach(() => {
		timer = new FakeTimer();
		clock = new FakeClock();
		connected = { mac: true, droplet: true };
		const worker = (id: string): PoolWorker => ({
			id,
			kind: "registered",
			slots: 1,
			platform: "linux",
			awake: connected[id] === true,
			checkouts: true,
			runs: () => true,
		});
		scheduler = new Scheduler(
			{ workers: () => Object.keys(connected).map(worker) },
			new FakeWallClock(0),
		);
		gone = new GoneWorkers({
			workers: () =>
				Object.entries(connected).map(([id, up]) => ({ id, connected: up })),
			scheduler,
			timer,
			clock,
			log: new MemoryLogger(),
		});
	});

	afterEach(() => gone.dispose());

	/** Moves the clock on by `by`, then looks, as each minute does. */
	const pass = (by: Duration) => {
		clock.advance(by);
		timer.fireIntervals();
	};

	/** Holds a slot on `worker`, as an agent placed there does. */
	const hold = (worker: string) =>
		scheduler.hold(
			{
				id: worker,
				task: "fix",
				agent: "claude",
				project: "/repo",
				platform: null,
			},
			worker,
		);

	it("frees the slots on a worker away past the bound, saying why", () => {
		const held = hold("mac");
		connected.mac = false;
		pass(Duration.ms(0));

		pass(GONE_AFTER.subtract(Duration.secs(1)));
		expect(held.lost.aborted).toBe(false);

		pass(Duration.secs(1));
		expect(held.lost.aborted).toBe(true);
		expect(String(held.lost.reason)).toContain("worker mac has been away 15m");
		expect(scheduler.held()).toEqual([]);
	});

	it("keeps them for a worker back in time, counting afresh from its next absence", () => {
		const held = hold("mac");
		connected.mac = false;
		pass(Duration.ms(0));
		pass(GONE_AFTER.subtract(Duration.secs(1)));
		connected.mac = true;
		pass(Duration.secs(1));
		connected.mac = false;
		pass(GONE_AFTER.subtract(Duration.secs(1)));

		expect(held.lost.aborted).toBe(false);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["mac"]);
	});

	it("leaves the slots of the workers still up", () => {
		hold("droplet");
		hold("mac");
		connected.mac = false;
		pass(Duration.ms(0));
		pass(GONE_AFTER);

		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["droplet"]);
	});
});

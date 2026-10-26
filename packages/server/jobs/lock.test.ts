import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { Accounting } from "./accounting";
import { type JobSpec, Priority } from "./job";
import { JobLock } from "./lock";
import { JobScheduler } from "./scheduler";
import { FakePools } from "./testing";

const SPEC: JobSpec = {
	what: "merge gate",
	priority: Priority.high,
	request: { resources: { cpus: 4 }, walltime: Duration.mins(3) },
};

describe("JobLock", () => {
	let scheduler: JobScheduler;
	let fallback: MemoryLock;
	let lock: JobLock;

	beforeEach(() => {
		scheduler = new JobScheduler(
			new FakePools({ cpus: 4 }),
			new Accounting(new MemoryStorage()),
			{
				clock: new FakeClock(),
				timer: new FakeTimer(),
				log: new MemoryLogger(),
			},
		);
		fallback = new MemoryLock();
		lock = new JobLock(scheduler, fallback, SPEC, new MemoryLogger());
	});
	afterEach(() => {
		scheduler.dispose();
	});

	it("holds its job once it starts, with its allocation, and finishes it on release", async () => {
		await lock.acquire();
		expect(lock.allocation).toEqual({ cpus: 4 });
		expect(scheduler.list().running).toHaveLength(1);

		await lock.release();

		expect(scheduler.list().running).toHaveLength(0);
		expect(lock.allocation).toBeNull();
	});

	it("waits its turn, telling its place meanwhile", async () => {
		const ahead = await scheduler.submit(SPEC);
		const places: number[] = [];

		const acquiring = lock.acquire((place) => {
			places.push(place);
		});
		await Bun.sleep(0);
		expect(places).toEqual([1]);
		await ahead.finish();
		await acquiring;

		expect(lock.allocation).toEqual({ cpus: 4 });
	});

	it("takes the fallback lock when nothing schedules jobs", async () => {
		const none = new JobLock(
			{
				submit: async () => {
					throw new Error("no server");
				},
			},
			fallback,
			SPEC,
			new MemoryLogger(),
		);

		await none.acquire();
		expect(none.allocation).toBeNull();
		let taken = false;
		const waiting = fallback.acquire().then(() => {
			taken = true;
		});
		await Bun.sleep(0);
		expect(taken).toBe(false);

		await none.release();
		await waiting;
		expect(taken).toBe(true);
	});

	it("gives its place up when the signal aborts", async () => {
		const ahead = await scheduler.submit(SPEC);
		const waiting = new AbortController();

		const acquiring = lock.acquire(undefined, waiting.signal);
		await Bun.sleep(0);
		waiting.abort(new Error("the branch conflicts with the base"));

		await expect(acquiring).rejects.toThrow("conflicts");
		await ahead.finish();
		expect(scheduler.list().waiting).toHaveLength(0);
	});
});

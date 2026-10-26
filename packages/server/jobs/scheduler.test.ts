import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { FakeClock, FakeTimer } from "webappwiz/time/testing";
import { MemoryStorage } from "../storage/testing";
import { Accounting } from "./accounting";
import { type JobSpec, Priority } from "./job";
import { AGE_CAP, JobScheduler } from "./scheduler";
import { FakePools } from "./testing";

describe("JobScheduler", () => {
	let pools: FakePools;
	let clock: FakeClock;
	let timer: FakeTimer;
	let accounting: Accounting;
	let scheduler: JobScheduler;
	let lock: MemoryLock;

	beforeEach(() => {
		pools = new FakePools({ cpus: 8, mem: 16000, suite: 1 });
		clock = new FakeClock();
		timer = new FakeTimer();
		accounting = new Accounting(new MemoryStorage());
		lock = new MemoryLock();
		scheduler = new JobScheduler(pools, accounting, {
			clock,
			timer,
			log: new MemoryLogger(),
			exclusive: { pool: "suite", lock },
		});
	});
	afterEach(() => {
		scheduler.dispose();
	});

	it("starts a job whose request fits, on what it asked", async () => {
		const job = await scheduler.submit(spec({ cpus: 4 }));

		expect(job.state).toBe("running");
		expect(job.allocation).toEqual({ cpus: 4 });
	});

	it("fills a range from what is free, never over its max nor under its min", async () => {
		const wide = await scheduler.submit(spec({ cpus: { min: 2, max: 6 } }));
		const narrow = await scheduler.submit(spec({ cpus: { min: 2, max: 6 } }));
		const short = await scheduler.submit(spec({ cpus: { min: 2, max: 6 } }));

		expect(wide.allocation).toEqual({ cpus: 6 });
		expect(narrow.allocation).toEqual({ cpus: 2 });
		expect(short.allocation).toBeNull();
	});

	it("queues what does not fit and tells each job its place as it changes", async () => {
		const first = await scheduler.submit(spec({ cpus: 8 }));
		const second = await scheduler.submit(spec({ cpus: 8 }));
		const third = await scheduler.submit(spec({ cpus: 8 }));
		const places: number[] = [];
		third.events.on("placed", (place) => places.push(place));
		expect([second.place, third.place]).toEqual([1, 2]);

		await first.finish();

		expect(second.allocation).toEqual({ cpus: 8 });
		expect(places).toEqual([1]);
	});

	it("orders the queue by priority, then by age", async () => {
		const running = await scheduler.submit(spec({ cpus: 8 }));
		const low = await scheduler.submit(
			spec({ cpus: 8 }, { priority: Priority.low }),
		);
		const high = await scheduler.submit(
			spec({ cpus: 8 }, { priority: Priority.high }),
		);
		expect([high.place, low.place]).toEqual([1, 2]);

		await running.finish();

		expect(high.allocation).toEqual({ cpus: 8 });
		expect(low.place).toBe(1);
	});

	it("counts what the machine measures in use beyond its jobs as taken", async () => {
		pools.inUse = { cpus: 6 };
		const job = await scheduler.submit(spec({ cpus: 4 }));
		expect(job.allocation).toBeNull();

		pools.inUse = { cpus: 1 };
		await scheduler.sweep();

		expect(job.allocation).toEqual({ cpus: 4 });
	});

	it("backfills a lower job behind the reserved head only when it is out of the way by then", async () => {
		await scheduler.submit(spec({ cpus: 6 }, { expected: Duration.mins(10) }));
		const head = await scheduler.submit(
			spec({ cpus: 8 }, { priority: Priority.high }),
		);
		const quick = await scheduler.submit(
			spec({ cpus: 2 }, { priority: Priority.low, expected: Duration.mins(1) }),
		);
		const slow = await scheduler.submit(
			spec(
				{ cpus: 2 },
				{ priority: Priority.low, expected: Duration.mins(20) },
			),
		);

		expect(head.place).toBe(1);
		expect(quick.allocation).toEqual({ cpus: 2 });
		expect(slow.allocation).toBeNull();
	});

	it("preempts the lowest requeue-able job far enough under a job that cannot fit, which waits again", async () => {
		const low = await scheduler.submit({
			...spec({ cpus: 8 }, { priority: Priority.low }),
			requeueable: true,
		});
		const told: string[] = [];
		low.events.on("preempted", () => told.push("preempted"));
		low.events.on("started", () => told.push("started"));

		const high = await scheduler.submit(
			spec({ cpus: 8 }, { priority: Priority.high }),
		);

		expect(high.allocation).toEqual({ cpus: 8 });
		expect(low.allocation).toBeNull();
		expect(low.place).toBe(1);
		await high.finish();
		expect(low.allocation).toEqual({ cpus: 8 });
		expect(told).toEqual(["preempted", "started"]);
	});

	it("never preempts a job within the gap, nor one that cannot be requeued", async () => {
		const near = await scheduler.submit({
			...spec({ cpus: 4 }, { priority: Priority.low }),
			requeueable: true,
		});
		const fixed = await scheduler.submit(
			spec({ cpus: 4 }, { priority: Priority.low }),
		);

		const higher = await scheduler.submit(
			spec({ cpus: 8 }, { priority: Priority.low + 5 }),
		);

		expect(near.allocation).toEqual({ cpus: 4 });
		expect(fixed.allocation).toEqual({ cpus: 4 });
		expect(higher.place).toBe(1);
	});

	it("expires a job past its walltime, unless renewed", async () => {
		const renewed = await scheduler.submit(
			spec({ cpus: 2 }, { walltime: Duration.mins(1) }),
		);
		const left = await scheduler.submit(
			spec({ cpus: 2 }, { walltime: Duration.mins(1) }),
		);
		const told: string[] = [];
		left.events.on("expired", () => told.push("expired"));

		clock.advance(Duration.secs(40));
		await renewed.renew();
		clock.advance(Duration.secs(30));
		timer.fireIntervals();
		await scheduler.sweep();

		expect(told).toEqual(["expired"]);
		expect(left.state).toBe("done");
		expect(renewed.state).toBe("running");
	});

	it("ages a waiting job a step a minute, up to the cap", async () => {
		await scheduler.submit(spec({ cpus: 8 }, { walltime: Duration.hrs(5) }));
		await scheduler.submit(spec({ cpus: 8 }, { priority: Priority.low }));
		clock.advance(Duration.mins(5));
		await scheduler.sweep();
		expect(scheduler.list().waiting[0]?.effective).toBe(5);

		clock.advance(Duration.hrs(2));
		await scheduler.sweep();

		expect(scheduler.list().waiting[0]?.effective).toBe(AGE_CAP);
	});

	it("takes the exclusive lock for a job of its pool before it runs, and gives it back after", async () => {
		await lock.acquire();
		const job = await scheduler.submit(spec({ cpus: 2, suite: 1 }));
		const told: string[] = [];
		job.events.on("started", () => told.push("started"));
		expect(job.state).toBe("starting");
		expect(scheduler.list().running).toHaveLength(1);

		await lock.release();
		await Bun.sleep(0);
		expect(told).toEqual(["started"]);

		await job.finish();
		await lock.acquire();
		await lock.release();
	});

	it("keeps a second job of the exclusive pool waiting while one holds it", async () => {
		const first = await scheduler.submit(spec({ cpus: 2, suite: 1 }));
		const second = await scheduler.submit(spec({ cpus: 2, suite: 1 }));
		expect(second.place).toBe(1);

		await first.finish();

		expect(second.allocation).toEqual({ cpus: 2, suite: 1 });
	});

	it("accounts each run, so the next of the same command is expected to take the median", async () => {
		const first = await scheduler.submit(spec({ cpus: 2 }));
		clock.advance(Duration.mins(2));
		await first.finish();
		const second = await scheduler.submit(spec({ cpus: 2 }));
		clock.advance(Duration.mins(4));
		await second.finish();

		const next = await scheduler.submit(spec({ cpus: 2 }));

		expect(next.expected).toEqual(Duration.mins(3));
	});

	it("starts nothing while paused, and the queue once resumed", async () => {
		scheduler.pause();
		const job = await scheduler.submit(spec({ cpus: 2 }));
		expect(job.allocation).toBeNull();
		expect(scheduler.list().paused).toBe(true);

		scheduler.resume();
		await scheduler.sweep();

		expect(job.allocation).toEqual({ cpus: 2 });
	});

	it("drops a waiting job whose signal aborts", async () => {
		await scheduler.submit(spec({ cpus: 8 }));
		const waiting = new AbortController();
		const job = await scheduler.submit(spec({ cpus: 8 }), waiting.signal);
		expect(scheduler.list().waiting).toHaveLength(1);

		waiting.abort();
		await scheduler.sweep();

		expect(scheduler.list().waiting).toHaveLength(0);
		expect(scheduler.find(job.id)).toBeNull();
	});
});

function spec(
	resources: JobSpec["request"]["resources"],
	{
		priority = Priority.normal,
		expected,
		walltime = Duration.mins(10),
	}: { priority?: number; expected?: Duration; walltime?: Duration } = {},
): JobSpec {
	return {
		what: "bun test",
		priority,
		request: {
			resources,
			walltime,
			...(expected === undefined ? {} : { expected }),
		},
	};
}

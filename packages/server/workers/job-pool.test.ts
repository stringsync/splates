import { beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { type JobAsk, JobPool } from "./job-pool";
import type { JobSize } from "./job-size";
import { FakeJobView } from "./testing";

/** Room for three jobs of the default size a runner, so placement among runners with room shows. */
const PER_RUNNER = 3;
const RUNNER: JobSize = { cpus: 12, memory: 24 };
const JOB: JobSize = { cpus: 4, memory: 8 };

describe("the job pool", () => {
	let view: FakeJobView;
	let ready: string[];
	let pool: JobPool;
	let count: number;
	let clock: FakeWallClock;

	const ask = (
		project = "/a",
		avoid: string[] = [],
		size: JobSize = JOB,
	): JobAsk => ({
		id: `job-${++count}`,
		project,
		task: null,
		what: "bun test",
		size,
		avoid,
	});

	beforeEach(() => {
		count = 0;
		ready = ["one"];
		view = new FakeJobView();
		view.size = RUNNER;
		view.runners = () => ready.map((id) => ({ id, ready: true, size: RUNNER }));
		clock = new FakeWallClock();
		pool = new JobPool(view, clock);
	});

	it("gives each runner three jobs at once and queues the rest in order", async () => {
		const placed = await Promise.all(
			Array.from({ length: PER_RUNNER }, () => pool.take(ask())),
		);
		let fourth: string | null | undefined;
		view.coming = 1;
		void pool.take(ask()).then((place) => {
			fourth = place.runner;
		});
		await Bun.sleep(0);

		expect(placed.map((each) => each.runner)).toEqual(["one", "one", "one"]);
		expect(pool.queue().map((each) => each.position)).toEqual([1]);
		expect(fourth).toBeUndefined();

		placed[0]?.dispose();
		await Bun.sleep(0);

		expect(fourth).toBe("one");
		expect(pool.queue()).toEqual([]);
	});

	it("places a first job ahead of the ordinary ones waiting", async () => {
		const full = await Promise.all(
			Array.from({ length: PER_RUNNER }, () => pool.take(ask())),
		);
		view.coming = 1;
		const order: string[] = [];
		const waiting = (id: string, first: boolean) =>
			void pool.take({ ...ask(), id, first }).then((place) => {
				order.push(id);
				place.dispose();
			});
		waiting("ordinary", false);
		waiting("gate", true);
		await Bun.sleep(0);
		expect(pool.queue().map((each) => each.id)).toEqual(["gate", "ordinary"]);

		full[0]?.dispose();
		await Bun.sleep(0);

		expect(order).toEqual(["gate", "ordinary"]);
	});

	it("sends a job to the runner with the most room", async () => {
		ready = ["one", "two"];
		await pool.take(ask("/a"));
		await pool.take(ask("/b"));

		expect(pool.running("one")).toBe(1);
		expect(pool.running("two")).toBe(1);
	});

	it("prefers a runner that holds the project's clone over one with more room", async () => {
		ready = ["one", "two"];
		const first = await pool.take(ask("/a"));
		await pool.take(ask("/b"));
		const again = await pool.take(ask("/a"));

		expect(again.runner).toBe(first.runner);
	});

	it("runs a job here when no runner is up or on its way and none can be made", async () => {
		ready = [];

		const place = await pool.take(ask());

		expect(place.runner).toBeNull();
	});

	it("waits for a runner that is on its way, or can be made", async () => {
		ready = [];
		view.making = true;
		let placed: string | null | undefined;
		void pool.take(ask()).then((place) => {
			placed = place.runner;
		});
		await Bun.sleep(0);

		expect(placed).toBeUndefined();
		expect(pool.short()).toBe(1);

		view.making = false;
		pool.poke();
		await Bun.sleep(0);

		expect(placed).toBeNull();
	});

	it("avoids a runner a job was lost on, and runs it here when no other can be had", async () => {
		const place = await pool.take(ask("/a", ["one"]));

		expect(place.runner).toBeNull();
	});

	it("tells of a job on a runner once as it ends, with how long it held its place", async () => {
		const ended: unknown[] = [];
		pool.events.on("ended", (job) => ended.push(job));
		const place = await pool.take(ask());
		const since = clock.now();
		clock.advance(Duration.secs(40));
		place.dispose();
		place.dispose();

		expect(ended).toEqual([
			{
				id: "job-1",
				project: "/a",
				task: null,
				what: "bun test",
				size: JOB,
				runner: "one",
				since,
				until: since + Duration.secs(40).ms,
			},
		]);
	});

	it("takes an aborted job out of the queue", async () => {
		ready = [];
		view.making = true;
		const abort = new AbortController();
		const waiting = pool.take(ask(), abort.signal);

		abort.abort(new Error("hung up"));

		await expect(waiting).rejects.toThrow("hung up");
		expect(pool.queue()).toEqual([]);
	});

	it("counts the room of runners up and those booting against the queue", async () => {
		await Promise.all(
			Array.from({ length: PER_RUNNER }, () => pool.take(ask())),
		);
		view.coming = 1;
		void Promise.all([
			pool.take(ask()),
			pool.take(ask()),
			pool.take(ask()),
			pool.take(ask()),
		]);
		await Bun.sleep(0);

		expect(pool.short()).toBe(1);
	});

	it("takes on one runner as many jobs as fit in its CPUs and memory, whatever their sizes", async () => {
		const big = await pool.take(ask("/a", [], { cpus: 8, memory: 4 }));
		const small = await pool.take(ask("/a", [], { cpus: 4, memory: 4 }));
		let third: string | null | undefined;
		view.coming = 1;
		void pool.take(ask("/a", [], { cpus: 1, memory: 1 })).then((place) => {
			third = place.runner;
		});
		await Bun.sleep(0);

		expect([big.runner, small.runner]).toEqual(["one", "one"]);
		expect(third).toBeUndefined();

		small.dispose();
		await Bun.sleep(0);

		expect(third).toBe("one");
	});

	it("keeps room freed on the runner a big job waits on from the small jobs behind it", async () => {
		const small = await Promise.all(
			Array.from({ length: PER_RUNNER }, () => pool.take(ask())),
		);
		const placed: string[] = [];
		const waiting = (id: string, size: JobSize) =>
			void pool.take({ ...ask(), id, size }).then((_place) => {
				placed.push(id);
			});
		waiting("big", { cpus: 8, memory: 16 });
		waiting("small-1", JOB);
		await Bun.sleep(0);

		small[0]?.dispose();
		waiting("small-2", JOB);
		await Bun.sleep(0);

		expect(placed).toEqual([]);
		expect(pool.queue().map((each) => each.id)).toEqual([
			"big",
			"small-1",
			"small-2",
		]);

		small[1]?.dispose();
		await Bun.sleep(0);

		expect(placed).toEqual(["big"]);

		small[2]?.dispose();
		await Bun.sleep(0);

		expect(placed).toEqual(["big", "small-1"]);
	});

	it("reserves the one runner nearest to having room for a waiting big job, so small jobs behind it go to another", async () => {
		ready = ["one", "two"];
		await pool.take(ask("/a"));
		await pool.take(ask("/a"));
		await pool.take(ask("/b"));
		void pool.take(ask("/a", [], { cpus: 12, memory: 8 }));

		const small = await pool.take(ask("/a"));

		expect(small.runner).toBe("one");
		expect(pool.queue().map((each) => each.id)).toEqual(["job-4"]);
	});

	it("waits on memory as on CPUs", async () => {
		await pool.take(ask("/a", [], { cpus: 1, memory: 20 }));
		view.coming = 1;

		void pool.take(ask("/a", [], { cpus: 1, memory: 8 }));
		await Bun.sleep(0);

		expect(pool.queue()).toHaveLength(1);
	});

	it("runs a job here that no runner up, on its way or to be made has room for", async () => {
		view.making = true;

		const place = await pool.take(ask("/a", [], { cpus: 16, memory: 8 }));

		expect(place.runner).toBeNull();
	});

	it("waits for a runner on its way big enough for a job none up has room for", async () => {
		ready = [];
		view.size = { cpus: 16, memory: 32 };
		view.coming = 1;
		let placed: string | null | undefined;
		void pool.take(ask("/a", [], { cpus: 16, memory: 8 })).then((place) => {
			placed = place.runner;
		});
		await Bun.sleep(0);

		expect(placed).toBeUndefined();
		expect(pool.short()).toBe(0);
	});

	it("counts a waiting job short when the room left on each runner is too little for it, however much there is in all", async () => {
		ready = ["one", "two"];
		await pool.take(ask("/a", [], { cpus: 8, memory: 8 }));
		await pool.take(ask("/b", [], { cpus: 8, memory: 8 }));
		view.making = true;

		void pool.take(ask("/a", [], { cpus: 8, memory: 8 }));
		await Bun.sleep(0);

		expect(pool.queue()).toHaveLength(1);
		expect(pool.short()).toBe(1);
	});
});

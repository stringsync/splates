import { beforeEach, describe, expect, it } from "bun:test";
import { FakeWallClock } from "webappwiz/time/testing";
import { JOBS_PER_RUNNER, type JobAsk, JobPool } from "./job-pool";
import { FakeJobView } from "./testing";

describe("the job pool", () => {
	let view: FakeJobView;
	let ready: string[];
	let pool: JobPool;
	let count: number;

	const ask = (project = "/a", avoid: string[] = []): JobAsk => ({
		id: `job-${++count}`,
		project,
		task: null,
		what: "bun test",
		avoid,
	});

	beforeEach(() => {
		count = 0;
		ready = ["one"];
		view = new FakeJobView();
		view.runners = () => ready.map((id) => ({ id, ready: true }));
		pool = new JobPool(view, new FakeWallClock());
	});

	it("gives each runner three jobs at once and queues the rest in order", async () => {
		const placed = await Promise.all(
			Array.from({ length: JOBS_PER_RUNNER }, () => pool.take(ask())),
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
			Array.from({ length: JOBS_PER_RUNNER }, () => pool.take(ask())),
		);
		view.coming = 1;
		void Promise.all([
			pool.take(ask()),
			pool.take(ask()),
			pool.take(ask()),
			pool.take(ask()),
		]);
		await Bun.sleep(0);

		expect(pool.room()).toBe(0);
		expect(pool.short()).toBe(1);
	});
});

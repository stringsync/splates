import { beforeEach, describe, expect, it } from "bun:test";
import { FakeWallClock } from "webappwiz/time/testing";
import { type PoolWorker, Scheduler, type SlotRequest } from "./scheduler";

describe("Scheduler", () => {
	let clock: FakeWallClock;
	let workers: PoolWorker[];
	let scheduler: Scheduler;
	/** Who was placed by `take`, in the order they were. */
	let placed: string[];
	/** Whether the pool is paused, as the server's records say. */
	let paused: boolean;

	beforeEach(() => {
		clock = new FakeWallClock(1_000);
		workers = [worker("local")];
		paused = false;
		scheduler = new Scheduler(
			{ workers: () => workers, paused: () => paused },
			clock,
		);
		placed = [];
	});

	/** Asks to place `id`, noting it in `placed` once it is. */
	const take = (id: string, overrides: Partial<SlotRequest> = {}) =>
		scheduler.take(request(id, overrides)).then((grant) => {
			placed.push(id);
			return grant;
		});

	it("places an agent at once", async () => {
		const grant = await take("a");
		expect(grant.worker).toBe("local");
		expect(scheduler.held()).toEqual([
			{
				id: "a",
				project: "/repo",
				task: "a",
				worker: "local",
				uncapped: false,
				since: 1_000,
			},
		]);
	});

	it("places every agent at once, however many run", async () => {
		await take("a");
		await take("b");
		await take("c");
		expect(placed).toEqual(["a", "b", "c"]);
		expect(scheduler.queue()).toEqual([]);
	});

	it("holds back what splates starts on its own while paused, still placing the person's own, and places it on resume", async () => {
		paused = true;
		clock.set(5_000);
		const automatic = take("a");
		const mine = await take("b", { uncapped: true });
		await settle();

		expect(mine.worker).toBe("local");
		expect(placed).toEqual(["b"]);
		expect(scheduler.queue()).toEqual([
			{
				id: "a",
				project: "/repo",
				task: "a",
				agent: "claude",
				position: 1,
				since: 5_000,
				reason: "paused",
			},
		]);

		paused = false;
		scheduler.poke();
		expect((await automatic).worker).toBe("local");
		expect(scheduler.queue()).toEqual([]);
	});

	it("tells each grant on a worker released that it is lost, and places the next elsewhere", async () => {
		// scry-ignore simple-test-setup: the two workers and the grants on each are this test's own inputs
		workers = [worker("local"), worker("box")];
		const here = await take("a");
		const there = await take("b");
		expect(there.worker).toBe("box");

		workers = [worker("local")];
		scheduler.release("box");

		expect(there.lost.aborted).toBe(true);
		expect(here.lost.aborted).toBe(false);
	});

	it("frees a hold once however often its grant is disposed", async () => {
		const first = await take("a");
		first.dispose();
		first.dispose();
		expect(scheduler.held()).toEqual([]);
	});

	it("serves the queue first come, first served, in the order the person sets", async () => {
		paused = true;
		void take("b");
		void take("c");
		void take("d");
		expect(scheduler.move("d", 1)).toBe(true);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["d", "b", "c"]);
		paused = false;
		scheduler.poke();
		await settle();
		expect(placed).toEqual(["d", "b", "c"]);
		expect(scheduler.move("nobody", 1)).toBe(false);
	});

	it("clamps a move to the ends of the queue", () => {
		paused = true;
		void take("b");
		void take("c");
		scheduler.move("b", 9);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["c", "b"]);
		scheduler.move("b", -3);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["b", "c"]);
	});

	it("takes a worker waiting on an update only when none on the coordinator's build is up", async () => {
		workers = [worker("local", { outdated: true }), worker("made")];
		expect((await take("a")).worker).toBe("made");
		workers = [worker("local", { outdated: true })];
		expect((await take("b")).worker).toBe("local");
	});

	it("passes over a worker that is away", async () => {
		workers = [
			worker("local", { awake: false }),
			worker("remote", { awake: false }),
		];
		const waiting = take("a");
		await settle();
		expect(placed).toEqual([]);
		workers = [worker("local")];
		scheduler.poke();
		expect((await waiting).worker).toBe("local");
	});

	it("says no worker is up when none it could run on is", () => {
		workers = [worker("local", { awake: false })];
		void take("a");
		expect(scheduler.spot("a")?.reason).toBe("no worker up");
	});

	it("says the worker drains when it is the only one that could run the agent", () => {
		workers = [worker("local", { awake: false, draining: true })];
		void take("a");
		expect(scheduler.spot("a")?.reason).toBe("worker draining");
	});

	it("spreads agents over equal workers by how many each runs", async () => {
		workers = [worker("one"), worker("two")];
		const first = await take("a", { uncapped: true });
		const second = await take("b");
		const third = await take("c", { uncapped: true });
		const fourth = await take("d");
		expect([first, second, third, fourth].map((grant) => grant.worker)).toEqual(
			["one", "two", "one", "two"],
		);
	});

	it("queues an agent the person started only while no worker is up", async () => {
		workers = [];
		const waiting = take("a", { uncapped: true });
		await settle();
		expect(scheduler.spot("a")?.reason).toBe("no worker up");
		workers = [worker("remote")];
		scheduler.poke();
		expect((await waiting).worker).toBe("remote");
	});

	it("counts a held agent toward its worker's load", async () => {
		workers = [worker("local"), worker("other")];
		scheduler.hold(request("a"), "local");
		expect((await take("b")).worker).toBe("other");
	});

	it("takes an agent out of the queue when its wait is aborted", async () => {
		paused = true;
		const abort = new AbortController();
		const waiting = scheduler.take(request("b"), abort.signal);
		abort.abort(new Error("stopped"));
		await expect(waiting).rejects.toThrow("stopped");
		expect(scheduler.queue()).toEqual([]);
	});

	it("says when the queue changes", async () => {
		let changes = 0;
		scheduler.events.on("changed", () => {
			changes += 1;
		});
		await take("a");
		expect(changes).toBeGreaterThan(0);
	});

	it("tells once of each worker that starts draining, and its grants that it drains", async () => {
		workers = [worker("local"), worker("w1")];
		const grant = await take("a", { task: "a" });
		const drains: string[] = [];
		scheduler.events.on("drain", (id) => drains.push(id));

		workers = [worker("local"), worker("w1", { draining: true })];
		scheduler.poke();
		scheduler.poke();
		expect(drains).toEqual(["w1"]);
		expect(grant.drains()).toBe(false);

		workers = [worker("local", { draining: true }), worker("w1")];
		scheduler.poke();
		expect(drains).toEqual(["w1", "local"]);
		expect(grant.drains()).toBe(true);

		workers = [worker("local"), worker("w1")];
		scheduler.poke();
		workers = [worker("local", { draining: true }), worker("w1")];
		scheduler.poke();
		expect(drains).toEqual(["w1", "local", "local"]);
	});
});

function worker(id: string, overrides: Partial<PoolWorker> = {}): PoolWorker {
	return {
		id,
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

/** Lets whatever a grant settled run. */
async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

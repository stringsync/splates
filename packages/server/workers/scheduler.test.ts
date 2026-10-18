import { beforeEach, describe, expect, it } from "bun:test";
import { FakeWallClock } from "webappwiz/time/testing";
import {
	type PoolWorker,
	platformOf,
	Scheduler,
	type SlotRequest,
} from "./scheduler";

describe("Scheduler", () => {
	let clock: FakeWallClock;
	let workers: PoolWorker[];
	let scheduler: Scheduler;
	/** Who got a slot from `take`, in the order they got one. */
	let placed: string[];

	beforeEach(() => {
		clock = new FakeWallClock(1_000);
		workers = [worker("local")];
		scheduler = new Scheduler({ workers: () => workers }, clock);
		placed = [];
	});

	/** Asks for a slot for `id`, noting it in `placed` once it has one. */
	const take = (id: string, overrides: Partial<SlotRequest> = {}) =>
		scheduler.take(request(id, overrides)).then((grant) => {
			placed.push(id);
			return grant;
		});

	it("places an agent on a free slot at once", async () => {
		const grant = await take("a");
		expect(grant.worker).toBe("local");
		expect(scheduler.held()).toEqual([
			{
				id: "a",
				project: "/repo",
				task: "a",
				worker: "local",
				uncapped: false,
			},
		]);
	});

	it("queues an agent once every slot is held, and places it when one frees", async () => {
		const first = await take("a");
		clock.set(5_000);
		const second = take("b");
		await settle();
		expect(placed).toEqual(["a"]);
		expect(scheduler.queue()).toEqual([
			{
				id: "b",
				project: "/repo",
				task: "b",
				platform: null,
				agent: "claude",
				position: 1,
				since: 5_000,
				reason: "no free slot",
			},
		]);
		first.dispose();
		expect((await second).worker).toBe("local");
		expect(scheduler.queue()).toEqual([]);
	});

	it("tells each grant on a worker released that it is lost, and places the next elsewhere", async () => {
		workers = [worker("box"), worker("local")];
		const here = await take("a");
		const there = await take("b");
		const next = take("c");
		await settle();

		workers = [worker("local", { slots: 2 })];
		scheduler.release("box");

		expect(there.lost.aborted).toBe(true);
		expect(here.lost.aborted).toBe(false);
		expect((await next).worker).toBe("local");
	});

	it("frees a slot once however often its grant is disposed", async () => {
		workers = [worker("local", { slots: 2 })];
		const first = await take("a");
		await take("b");
		first.dispose();
		first.dispose();
		void take("c");
		void take("d");
		await settle();
		expect(placed).toEqual(["a", "b", "c"]);
	});

	it("serves the queue first come, first served, in the order the person sets", async () => {
		const first = await take("a");
		void take("b");
		void take("c");
		void take("d");
		expect(scheduler.move("d", 1)).toBe(true);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["d", "b", "c"]);
		first.dispose();
		await settle();
		expect(placed).toEqual(["a", "d"]);
		expect(scheduler.move("nobody", 1)).toBe(false);
	});

	it("clamps a move to the ends of the queue", async () => {
		await take("a");
		void take("b");
		void take("c");
		scheduler.move("b", 9);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["c", "b"]);
		scheduler.move("b", -3);
		expect(scheduler.queue().map((entry) => entry.id)).toEqual(["b", "c"]);
	});

	it("goes back to the worker an agent last ran on, else the local one", async () => {
		workers = [worker("remote"), worker("local", { slots: 2 })];
		scheduler.hold(request("a"), "remote").dispose();
		expect((await take("a")).worker).toBe("remote");
		expect((await take("b")).worker).toBe("local");
	});

	it("falls back to a registered worker when the local one is full", async () => {
		workers = [worker("local"), worker("remote")];
		expect((await take("a")).worker).toBe("local");
		expect((await take("b")).worker).toBe("remote");
	});

	it("takes a worker paid by the hour only when no other has room", async () => {
		workers = [
			worker("made", { kind: "provisioned" }),
			worker("remote"),
			worker("local"),
		];
		expect((await take("a")).worker).toBe("local");
		expect((await take("b")).worker).toBe("remote");
		expect((await take("c")).worker).toBe("made");
	});

	it("takes a worker waiting on an update only when none on the coordinator's build has room", async () => {
		workers = [
			worker("local", { outdated: true }),
			worker("made", { kind: "provisioned" }),
		];
		scheduler.hold(request("a"), "local").dispose();
		expect((await take("a")).worker).toBe("made");
		expect((await take("b")).worker).toBe("local");
	});

	it("passes over a worker that is away or cannot hold the checkout", async () => {
		workers = [
			worker("local", { awake: false }),
			worker("remote", { checkouts: false }),
		];
		const waiting = take("a");
		await settle();
		expect(placed).toEqual([]);
		workers = [worker("local")];
		scheduler.poke();
		expect((await waiting).worker).toBe("local");
	});

	it("places only on the platform a project requires, letting others past", async () => {
		void take("a", { platform: "linux" });
		await take("b");
		expect(placed).toEqual(["b"]);
		expect(scheduler.spot("a")?.reason).toBe("needs Linux");
	});

	it("says a free slot is what an agent waits for once its platform has a worker", async () => {
		workers = [worker("local", { platform: "linux" })];
		await take("a");
		void take("b", { platform: "linux" });
		expect(scheduler.spot("b")?.reason).toBe("no free slot");
	});

	it("says no worker is up when none it could run on is", async () => {
		workers = [worker("local", { awake: false })];
		void take("a");
		expect(scheduler.spot("a")?.reason).toBe("no worker up");
	});

	it("places an uncapped agent on a full worker, taking no slot from the rest", async () => {
		await take("a");
		expect((await take("b", { uncapped: true })).worker).toBe("local");
		const capped = take("c");
		await settle();
		expect(placed).toEqual(["a", "b"]);
		workers = [worker("local", { slots: 2 })];
		scheduler.poke();
		expect((await capped).worker).toBe("local");
	});

	it("queues an uncapped agent only while no worker is up", async () => {
		workers = [];
		const waiting = take("a", { uncapped: true });
		await settle();
		expect(scheduler.spot("a")?.reason).toBe("no worker up");
		workers = [worker("remote")];
		scheduler.poke();
		expect((await waiting).worker).toBe("remote");
	});

	it("places an agent only on a worker that holds its key, letting others past", async () => {
		workers = [
			worker("local", { awake: false }),
			worker("box", { runs: (agent) => agent !== "codex" }),
		];
		void take("a", { agent: "codex" });
		await take("b");
		expect(placed).toEqual(["b"]);
		expect(scheduler.spot("a")?.reason).toBe("needs a key for codex");
	});

	it("counts a held agent against its worker's slots", async () => {
		scheduler.hold(request("a"), "local");
		void take("b");
		await settle();
		expect(placed).toEqual([]);
	});

	it("takes an agent out of the queue when its wait is aborted", async () => {
		await take("a");
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

	it("names each platform as people do", () => {
		expect(
			["darwin", "linux", "win32", "aix"].map((each) => platformOf(each)),
		).toEqual(["macos", "linux", "windows", null]);
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

/** Lets whatever a grant settled run. */
async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

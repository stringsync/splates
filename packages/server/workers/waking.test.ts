import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { type PoolWorker, Scheduler, type SlotRequest } from "./scheduler";
import { WorkerWaking } from "./waking";

describe("WorkerWaking", () => {
	it("wakes a sleeping worker for an agent no awake one can take, which it seats once it joins", async () => {
		const { scheduler, waking, sent, pc } = setup();

		const placed = scheduler.take(request("a"));

		expect(sent).toEqual(["pc"]);
		expect(waking.waking("pc")).toBe(true);
		expect(waking.seats()).toBe(4);
		expect(scheduler.spot("a")?.reason).toBe("waking a worker");

		pc.awake = true;
		pc.asleep = false;
		waking.joined("pc");
		scheduler.poke();

		expect((await placed).worker).toBe("pc");
		expect(waking.seats()).toBe(0);
	});

	it("wakes none while an awake worker has a free slot", async () => {
		const { scheduler, sent, pool } = setup();
		pool.push(worker("mac", { awake: true }));

		expect((await scheduler.take(request("a"))).worker).toBe("mac");
		expect(sent).toEqual([]);
	});

	it("wakes one for the person's own agent too, which no slot caps", () => {
		const { scheduler, sent } = setup();

		void scheduler.take({ ...request("a"), uncapped: true });

		expect(sent).toEqual(["pc"]);
	});

	it("wakes only as many as those waiting need", () => {
		const { scheduler, sent, pool } = setup();
		pool.push(worker("other-pc", { asleep: true }));

		void scheduler.take(request("a"));
		void scheduler.take(request("b"));

		expect(sent).toEqual(["pc"]);
	});

	it("wakes none that could not run what waits", () => {
		const { scheduler, sent } = setup();

		void scheduler.take({ ...request("a"), platform: "windows" });

		expect(sent).toEqual([]);
	});

	it("stops counting on one that does not join in time, and wakes it for the queue no more", () => {
		const { scheduler, waking, sent, timer } = setup();
		const missed: string[] = [];
		waking.events.on("missed", (id) => missed.push(id));
		void scheduler.take(request("a"));

		timer.fireTimeouts();

		expect(missed).toEqual(["pc"]);
		expect(waking.seats()).toBe(0);
		expect(scheduler.spot("a")?.reason).toBe("no worker up");
		void scheduler.take(request("b"));
		expect(sent).toEqual(["pc"]);
	});

	it("gives up at once on one no packet could be sent for", async () => {
		const { scheduler, waking } = setup({ fails: true });
		const missed = new Promise<string>((resolve) =>
			waking.events.on("missed", resolve),
		);

		void scheduler.take(request("a"));

		expect(await missed).toBe("pc");
		expect(waking.seats()).toBe(0);
	});

	it("wakes one when the person asks, even after it missed a wake", async () => {
		const { scheduler, waking, sent, timer } = setup();
		void scheduler.take(request("a"));
		timer.fireTimeouts();

		await waking.wake("pc");

		expect(sent).toEqual(["pc", "pc"]);
		expect(waking.waking("pc")).toBe(true);
	});

	it("refuses to wake one that is not asleep", async () => {
		const { waking, pool } = setup();
		pool.push(worker("mac", { awake: true }));

		await expect(waking.wake("mac")).rejects.toThrow("not asleep");
	});
});

function setup({ fails = false }: { fails?: boolean } = {}) {
	const pc = worker("pc", { asleep: true });
	const pool: PoolWorker[] = [pc];
	const sent: string[] = [];
	const timer = new FakeTimer();
	const scheduler = new Scheduler(
		{
			workers: () =>
				pool.map((each) => ({ ...each, waking: waking.waking(each.id) })),
		},
		{ now: () => 0 },
	);
	const waking: WorkerWaking = new WorkerWaking({
		pool: { workers: () => pool },
		send: async (id) => {
			sent.push(id);
			if (fails) {
				throw new Error("no worker is awake on its network");
			}
		},
		timer,
		log: new MemoryLogger(),
	});
	waking.watch(scheduler);
	return { scheduler, waking, sent, timer, pc, pool };
}

function worker(id: string, of: Partial<PoolWorker>): PoolWorker {
	return {
		id,
		kind: "registered",
		slots: 4,
		platform: "linux",
		awake: false,
		checkouts: true,
		runs: () => true,
		...of,
	};
}

function request(id: string): SlotRequest {
	return { id, project: "/p", task: null, platform: null, agent: "claude" };
}

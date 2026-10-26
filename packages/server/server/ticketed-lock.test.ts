import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { TicketedLock } from "./ticketed-lock";

describe("TicketedLock", () => {
	let fs: FakeFs;
	let ps: FakePs;
	let inner: MemoryLock;
	let log: MemoryLogger;
	let lock: TicketedLock;
	let places: number[][];
	/** A waiter whose places are kept in `places[who]`. */
	let waiter: (who: number) => Promise<void>;

	beforeEach(() => {
		fs = new FakeFs();
		ps = new FakePs();
		inner = new MemoryLock();
		log = new MemoryLogger();
		lock = new TicketedLock(inner, "/home/premerge.queue", {
			fs,
			ps,
			log,
			pollMs: 5,
		});
		places = [[], [], []];
		waiter = (who) =>
			lock.acquire((place) => {
				places[who]?.push(place);
			});
	});

	it("tells a lone waiter it is next, and leaves no ticket once it holds the lock", async () => {
		await waiter(0);

		expect(places[0]).toEqual([1]);
		expect(await fs.readdir("/home/premerge.queue")).toEqual([]);
	});

	it("tells each waiter its place as the ones ahead take the lock", async () => {
		await waiter(0);
		const second = waiter(1);
		await Bun.sleep(20);
		const third = waiter(2);
		await Bun.sleep(20);
		expect([places[1], places[2]]).toEqual([[1], [2]]);

		await lock.release();
		await second;
		await Bun.sleep(20);
		expect(places[2]).toEqual([2, 1]);

		await lock.release();
		await third;
		await lock.release();
	});

	it("serves a waiter that asks to go ahead before those waiting behind the next", async () => {
		places = [[], [], [], []];
		await waiter(0);
		const next = waiter(1);
		const behind = waiter(2);
		await Bun.sleep(20);
		const ahead = lock.acquire(
			(place) => {
				places[3]?.push(place);
			},
			undefined,
			{ ahead: true },
		);
		await Bun.sleep(20);
		expect([places[2], places[3]]).toEqual([[2, 3], [2]]);

		const order: string[] = [];
		const done = (who: string) => () => order.push(who);
		void next.then(done("next"));
		void behind.then(done("behind"));
		void ahead.then(done("ahead"));
		await lock.release();
		await Bun.sleep(20);
		await lock.release();
		await Bun.sleep(20);
		await lock.release();
		await Bun.sleep(20);
		await lock.release();
		expect(order).toEqual(["next", "ahead", "behind"]);
	});

	it("drops the ticket of a waiter whose process is gone, whatever hostname it was written under", async () => {
		await fs.mkdir("/home/premerge.queue", { recursive: true });
		await fs.write(
			"/home/premerge.queue/000000000000001-99-0",
			JSON.stringify({
				pid: 99,
				hostname: "Mac",
				at: "2026-10-23T00:00:00.000Z",
			}),
		);
		ps.kill(99);

		await waiter(0);

		expect(places[0]).toEqual([1]);
		expect(await fs.readdir("/home/premerge.queue")).toEqual([]);
		expect(log.entries.map((entry) => entry.message)).toEqual([
			expect.stringContaining("dropping premerge ticket"),
		]);
	});

	it("waits behind a ticket it cannot read yet, until it is old enough to be gone", async () => {
		await fs.mkdir("/home/premerge.queue", { recursive: true });
		await fs.write(
			`/home/premerge.queue/${String(Date.now() - 10).padStart(15, "0")}-7-0`,
			"",
		);
		const staleLater = new TicketedLock(inner, "/home/premerge.queue", {
			fs,
			ps,
			log,
			pollMs: 5,
			stalenessMs: 60,
		});
		const seen: number[] = [];

		await staleLater.acquire((place) => void seen.push(place));

		expect(seen).toEqual([2, 1]);
	});

	// scry-ignore simple-test-setup: older than this task, and its aborted waiter is its own input
	it("gives up its place when its signal aborts, leaving no ticket and the lock to the next", async () => {
		await waiter(0);
		const gone = new AbortController();
		const second = lock.acquire(undefined, gone.signal);
		await Bun.sleep(20);
		const third = waiter(2);
		await Bun.sleep(20);
		expect(places[2]).toEqual([2]);

		gone.abort(new Error("landed in a batch"));
		await expect(second).rejects.toThrow("landed in a batch");
		await Bun.sleep(20);
		expect(places[2]).toEqual([2, 1]);
		expect(await fs.readdir("/home/premerge.queue")).toHaveLength(1);

		await lock.release();
		await third;
		await lock.release();
	});

	it("keeps a lock it had before its signal aborted", async () => {
		const gone = new AbortController();
		await lock.acquire(undefined, gone.signal);
		gone.abort();

		const second = waiter(1);
		await Bun.sleep(20);
		expect(places[1]).toEqual([1]);
		await lock.release();
		await second;
		await lock.release();
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { MemoryLock } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { capOf, HEAVY_HELD, HEAVY_JOBS_DEFAULT, HeavyJobs } from "./heavy";

describe("HeavyJobs", () => {
	let dead: Set<number>;
	let log: MemoryLogger;
	// Each a process of one machine: one file and one lock, a ps each.
	let process: (
		pid: number,
		opts?: { cap?: number; env?: Record<string, string> },
	) => HeavyJobs;

	beforeEach(() => {
		const fs = new FakeFs();
		const lock = new MemoryLock();
		dead = new Set();
		log = new MemoryLogger();
		process = (pid, { cap = 2, env = {} } = {}) => {
			const ps = new FakePs();
			ps.pid = pid;
			ps.alive = (each: number) => !dead.has(each);
			ps.setEnv(env);
			return new HeavyJobs("/home/.arbor/heavy.json", {
				fs,
				ps,
				lock,
				log,
				cap,
			});
		};
	});

	it("runs as many jobs as the cap at once, and the next once one gives back", async () => {
		const one = await process(1).take({ what: "preMerge", task: "a" });
		await process(2).take({ what: "bun test" });

		let third = false;
		const taking = process(3)
			.take({ what: "bun install", task: "c" })
			.then((slot) => {
				third = true;
				return slot;
			});
		await Bun.sleep(120);
		expect(third).toBe(false);
		const reading = await process(9).read();
		expect(reading.running.map((each) => each.what)).toEqual([
			"preMerge",
			"bun test",
		]);
		expect(reading.waiting.map((each) => each.what)).toEqual(["bun install"]);
		expect(log.entries.map((each) => each.message).join("\n")).toContain(
			"waiting for one of 2 heavy-job slots for bun install, held by:\n  preMerge in a (pid 1",
		);

		await one[Symbol.asyncDispose]();
		await taking;
		expect(third).toBe(true);
		expect((await process(9).read()).running.map((each) => each.what)).toEqual([
			"bun test",
			"bun install",
		]);
	});

	it("frees the slot of a holder that died without giving it back", async () => {
		await process(1, { cap: 1 }).take({ what: "bun test" });
		dead.add(1);

		await process(2, { cap: 1 }).take({ what: "preMerge" });

		expect((await process(9).read()).running.map((each) => each.pid)).toEqual([
			2,
		]);
	});

	it("serves waiters first come first", async () => {
		const held = await process(1, { cap: 1 }).take({ what: "first" });
		const order: string[] = [];
		const second = process(2, { cap: 1 })
			.take({ what: "second" })
			.then(async (slot) => {
				order.push("second");
				await slot[Symbol.asyncDispose]();
			});
		await Bun.sleep(20);
		const third = process(3, { cap: 1 })
			.take({ what: "third" })
			.then(() => order.push("third"));
		await Bun.sleep(20);

		await held[Symbol.asyncDispose]();
		await Promise.all([second, third]);
		expect(order).toEqual(["second", "third"]);
	});

	it("runs a job its parent's slot holds without taking another", async () => {
		const jobs = process(1, { cap: 1, env: { [HEAVY_HELD]: "7-0" } });

		const slot = await jobs.take({ what: "bun test" });

		expect(slot.env).toEqual({});
		expect((await jobs.read()).running).toEqual([]);
	});

	it("tells what runs in a slot that it holds one", async () => {
		const slot = await process(1).take({ what: "bun test" });
		expect(Object.keys(slot.env)).toEqual([HEAVY_HELD]);
	});

	it("reads the cap as a positive whole number, falling back on anything else", () => {
		expect(capOf("4")).toBe(4);
		expect(capOf(undefined)).toBe(HEAVY_JOBS_DEFAULT);
		expect(capOf("0")).toBe(HEAVY_JOBS_DEFAULT);
		expect(capOf("two")).toBe(HEAVY_JOBS_DEFAULT);
	});
});

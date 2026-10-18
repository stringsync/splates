import { describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { StartLock } from "./start-lock";

describe("StartLock", () => {
	const deps = () => ({
		fs: new FakeFs(),
		ps: new FakePs(),
		log: new MemoryLogger(),
	});

	it("starts one at a time within a process, through the file", async () => {
		const lock = new StartLock("/home/.splates/starting.lock", deps());
		const order: string[] = [];
		await lock.acquire();
		const second = lock.acquire().then(() => order.push("second"));
		await Bun.sleep(5);
		order.push("first released");
		await lock.release();
		await second;
		await lock.release();

		expect(order).toEqual(["first released", "second"]);
	});

	it("waits on a start another process holds on the same file", async () => {
		const shared = deps();
		const one = new StartLock("/home/.splates/starting.lock", shared);
		const other = new StartLock("/home/.splates/starting.lock", shared);
		await one.acquire();
		let took = false;
		const taking = other.acquire().then(() => {
			took = true;
		});
		await Bun.sleep(20);
		expect(took).toBe(false);

		await one.release();
		await taking;
		expect(took).toBe(true);
		await other.release();
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import { ConsoleLogger } from "webappwiz/log";
import { TimedLock } from "./premerge";

describe("TimedLock", () => {
	let calls: string[];
	let lock: TimedLock;

	beforeEach(() => {
		calls = [];
		const inner = {
			acquire: async () => void calls.push("acquire"),
			release: async () => void calls.push("release"),
			releaseIfOurs: async () => void calls.push("ours"),
		};
		const log = new ConsoleLogger();
		lock = new TimedLock(inner, 10, { ...log, error: () => {} } as never);
	});

	it("lets go of a lock held past its time", async () => {
		await lock.acquire();
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire", "release"]);
	});

	it("releases once when its holder releases in time", async () => {
		await lock.acquire();
		await lock.release();
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire", "release"]);
	});

	it("has its time again from a renewal", async () => {
		await lock.acquire();
		await Bun.sleep(6);
		lock.renew();
		await Bun.sleep(6);
		expect(calls).toEqual(["acquire"]);
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire", "release"]);
	});

	it("holds for the time a renewal gives, past its own", async () => {
		await lock.acquire();
		lock.renew(60);
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire"]);
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire", "release"]);
	});

	it("renews nothing it no longer holds", async () => {
		await lock.acquire();
		await lock.release();
		lock.renew();
		await Bun.sleep(40);
		expect(calls).toEqual(["acquire", "release"]);
	});
});

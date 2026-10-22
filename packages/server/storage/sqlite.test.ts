import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { SqliteStorage } from "./index";

/** Whose process a storage opens as, and what times its polls. */
interface Opening {
	ps?: FakePs;
	timer?: FakeTimer;
}

describe("SqliteStorage", () => {
	const made: string[] = [];
	const opened: SqliteStorage[] = [];
	afterEach(async () => {
		for (const storage of opened.splice(0)) {
			storage.dispose();
		}
		for (const dir of made.splice(0)) {
			await rm(dir, { recursive: true, force: true });
		}
	});
	/** A storage on the one database file every call of a test opens. */
	async function open(opts: Opening = {}) {
		if (made.length === 0) {
			made.push(await mkdtemp(join(tmpdir(), "splates-sqlite-")));
		}
		const storage = SqliteStorage.open(`${made[0]}/state.db`, {
			fs: new NodeFs(),
			ps: opts.ps ?? new FakePs(),
			timer: opts.timer,
		});
		opened.push(storage);
		return storage;
	}

	it("tells a watch of what another process wrote, once it polls", async () => {
		const timer = new FakeTimer();
		const watcher = await open({ timer });
		const writer = await open();
		const keys: string[] = [];
		const watch = watcher.watch("tasks");
		watch.events.on("changed", (key) => keys.push(key));

		await writer.collection("tasks").write("1.md", "first");
		expect(keys).toEqual([]);
		timer.fireIntervals();

		expect(keys).toEqual(["tasks/1.md"]);
		watch.dispose();
	});

	it("tells of its own process's write at once, and not again on polling", async () => {
		const timer = new FakeTimer();
		const storage = await open({ timer });
		const keys: string[] = [];
		const watch = storage.watch("tasks");
		watch.events.on("changed", (key) => keys.push(key));

		await storage.collection("tasks").write("1.md", "first");
		timer.fireIntervals();

		expect(keys).toEqual(["tasks/1.md"]);
		watch.dispose();
	});

	it("steals a lock from a process that died", async () => {
		const dead = new FakePs();
		dead.pid = 4242;
		const held = (await open({ ps: dead })).lock("merge.lock");
		await held.acquire();
		const ps = new FakePs();
		ps.kill(4242);

		await (await open({ ps })).lock("merge.lock").acquire();
	});

	it("waits for a lock a live process holds", async () => {
		const ps = new FakePs();
		const storage = await open({ ps });
		const first = storage.lock("merge.lock");
		await first.acquire();
		let taken = false;
		const second = storage
			.lock("merge.lock")
			.acquire()
			.then(() => {
				taken = true;
			});
		await Bun.sleep(30);

		expect(taken).toBe(false);
		await first.release();
		await second;

		expect(taken).toBe(true);
	});

	it("lists a log among a collection's names, as a directory holds its files", async () => {
		const storage = await open();
		await storage.log("a.jsonl").append({ n: 1 });
		await storage.collection("").write("b.md", "record");

		expect(await storage.collection("").list()).toEqual(["a.jsonl", "b.md"]);
		expect(await storage.collection("").read("a.jsonl")).toBe('{"n":1}\n');
	});

	it("keeps what was written for the next opening", async () => {
		const storage = await open();
		await storage.document("push.json").write({ on: true });
		await storage.log("log.jsonl").append({ n: 1 });
		storage.dispose();
		opened.splice(0);

		const again = await open();

		expect(await again.document("push.json").read()).toEqual({ on: true });
		expect(await again.log("log.jsonl").replay()).toEqual([{ n: 1 }]);
	});

	it("materializes a rotated segment as its lines", async () => {
		const fs = new FakeFs();
		const storage = SqliteStorage.open(":memory:", {
			fs,
			ps: new FakePs(),
			cache: "/cache",
		});
		opened.push(storage);
		const log = storage.log<{ n: number }>("log.jsonl", { segments: "log" });
		await log.append({ n: 1 });
		const segment = await log.rotate();

		const path = await storage.materialize(`log/${segment?.name}`);

		expect(path).toBe(`/cache/log/${segment?.name}`);
		expect(await fs.read(path)).toBe('{"n":1}\n');
	});
});

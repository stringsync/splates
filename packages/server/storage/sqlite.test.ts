import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FakeTimer } from "webappwiz/time/testing";
import { SqliteStorage } from "./index";
import { rotated } from "./testing";

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

	it("steals a lock from a process that died, whatever hostname it was taken under", async () => {
		// macOS renames the machine as its network changes.
		const dead = new FakePs();
		dead.pid = 4242;
		dead.hostname = "Mac";
		const held = (await open({ ps: dead })).lock("merge.lock");
		await held.acquire();
		const ps = new FakePs();
		ps.hostname = "jmbp.local";
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
		// Renamed by macOS as its network changed, it still releases its own.
		ps.hostname = "jmbp.local";
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

	// scry-ignore simple-test-setup: older than this task, and its old database is its own input
	it("shrinks a database made before it gave space back, once, keeping what it holds", async () => {
		await open();
		const path = `${made[0]}/state.db`;
		const old = new Database(path);
		old.exec("PRAGMA auto_vacuum = NONE");
		old.exec("VACUUM");
		old.exec("CREATE TABLE filler (data BLOB)");
		old.query("INSERT INTO filler VALUES (zeroblob(?))").run(MB * 8);
		old.exec("DROP TABLE filler");
		old.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		const before = Bun.file(path).size;
		old.close();
		const storage = await open();
		await storage.collection("tasks").write("1.md", "kept");

		expect(before).toBeGreaterThan(MB * 8);
		expect(Bun.file(path).size).toBeLessThan(MB);
		expect(await (await open()).collection("tasks").read("1.md")).toBe("kept");
	});

	it("gives free pages back as it writes", async () => {
		await open();
		const path = `${made[0]}/state.db`;
		await (await open()).collection("blobs").write("big", "x".repeat(MB * 16));
		const grown = Bun.file(path).size;

		// A storage opened afresh tidies on its first write.
		await (await open()).collection("blobs").remove("big");
		const db = new Database(path);
		db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		db.close();

		expect(grown).toBeGreaterThan(MB * 16);
		expect(Bun.file(path).size).toBeLessThan(MB);
	});

	it("adds the owner index to an existing database without changing live or rotated log sizes", async () => {
		const storage = await open();
		const log = storage.log<{ text: string }>("conversations/one.jsonl", {
			segments: "conversations/one/segments",
		});
		await log.append({ text: "é" });
		const segment = await rotated(log);
		await log.append({ text: "live" });
		await storage.collection("conversations/one/artifacts").write("a", "abc");
		const path = `${made[0]}/state.db`;
		const db = new Database(path);
		try {
			// Simulate a database created before owner range queries had an index.
			db.exec("DROP INDEX entries_by_key");
			const upgraded = await open();
			expect(
				db
					.query("SELECT name FROM sqlite_master WHERE name = 'entries_by_key'")
					.get(),
			).not.toBeNull();
			expect(await upgraded.size("conversations/one/artifacts")).toBe(3);
			expect(await upgraded.size("conversations/one/segments")).toBe(
				new TextEncoder().encode('{"text":"é"}\n').length,
			);
			expect(
				await upgraded.within("conversations").collection("").entries(),
			).toEqual([
				{
					name: "one.jsonl",
					size: new TextEncoder().encode('{"text":"live"}\n').length,
				},
			]);
			expect(
				await upgraded
					.log<{ text: string }>("conversations/one.jsonl")
					.replay(),
			).toEqual([{ text: "live" }]);
			expect(segment).not.toBeNull();
			expect(
				await upgraded
					.log<{ text: string }>("conversations/one.jsonl", {
						segments: "conversations/one/segments",
					})
					.replaySegment(segment),
			).toEqual([{ text: "é" }]);
		} finally {
			db.close();
		}
	});
});

const MB = 1024 * 1024;

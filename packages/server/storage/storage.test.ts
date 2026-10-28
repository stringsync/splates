import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Resource } from "webappwiz/disposable";
import { NodeFs } from "webappwiz/system";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { z } from "zod";
import { FsStorage, SqliteStorage, type Storage } from "./index";
import { MemoryStorage, rotated } from "./testing";

const made: string[] = [];
const opened: Resource[] = [];
afterAll(async () => {
	for (const storage of opened) {
		storage.dispose();
	}
	for (const dir of made) {
		await rm(dir, { recursive: true, force: true });
	}
});

// Every backend keeps the same promises, so a store moved onto storage runs
// the same on any of them.
describe.each([
	{
		backend: "memory",
		open: async (): Promise<Storage> => new MemoryStorage(),
	},
	{
		backend: "a fake disk",
		open: async (): Promise<Storage> => new FsStorage("/home/s", new FakeFs()),
	},
	{
		backend: "the disk",
		open: async (): Promise<Storage> => {
			const dir = await realpath(
				await mkdtemp(join(tmpdir(), "splates-storage-")),
			);
			made.push(dir);
			return new FsStorage(dir, new NodeFs());
		},
	},
	{
		backend: "sqlite",
		open: async (): Promise<Storage> => {
			const dir = await realpath(
				await mkdtemp(join(tmpdir(), "splates-storage-")),
			);
			made.push(dir);
			const storage = SqliteStorage.open(`${dir}/state.db`, {
				fs: new NodeFs(),
				ps: new FakePs(),
				pollMs: 20,
			});
			opened.push(storage);
			return storage;
		},
	},
])("storage on $backend", ({ open }) => {
	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("document", () => {
		it("reads null until written, then what was written", async () => {
			const settings = (await open()).document<{ on: boolean }>("push.json");

			expect(await settings.read()).toBeNull();
			await settings.write({ on: true });

			expect(await settings.read()).toEqual({ on: true });
		});

		it("reads null again once removed", async () => {
			const settings = (await open()).document("push.json");
			await settings.write({ on: true });

			await settings.remove();

			expect(await settings.read()).toBeNull();
		});

		it("keeps every update made at once", async () => {
			const storage = await open();
			const counts = [1, 2, 3, 4, 5].map(() =>
				storage.document<number>("count.json"),
			);

			await Promise.all(
				counts.map((count) => count.update((total) => (total ?? 0) + 1)),
			);

			expect(await storage.document("count.json").read()).toBe(5);
		});

		it("refuses what its schema refuses", async () => {
			const storage = await open();
			await storage.document("count.json").write("five");
			const count = storage.document("count.json", { schema: z.number() });

			expect(count.read()).rejects.toThrow("expected number");
		});
	});

	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("log", () => {
		it("replays what was appended, in order", async () => {
			const log = (await open()).log<{ n: number }>("log.jsonl");

			await log.append({ n: 1 });
			await log.append({ n: 2 }, { n: 3 });

			expect(await log.replay()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
		});

		it("exists once appended to, and no longer once rotated", async () => {
			const log = (await open()).log<number>("log.jsonl");
			expect(await log.exists()).toBe(false);

			await log.append(1);
			expect(await log.exists()).toBe(true);

			await rotated(log);
			expect(await log.exists()).toBe(false);
		});

		it("leaves out the entries its schema refuses", async () => {
			const storage = await open();
			await storage.log("log.jsonl").append({ n: 1 }, "torn", { n: 2 });
			const log = storage.log("log.jsonl", {
				schema: z.object({ n: z.number() }),
			});

			expect(await log.replay()).toEqual([{ n: 1 }, { n: 2 }]);
		});

		it("reads its first entry, and none once empty", async () => {
			const log = (await open()).log<number>("log.jsonl");
			expect(await log.first()).toBeNull();

			await log.append(1, 2);

			expect(await log.first()).toBe(1);
		});

		it("compacts its entries in place, ahead of those appended after", async () => {
			const log = (await open()).log<number>("log.jsonl");
			await log.append(1, 2, 3);

			await log.compact((entries) => [
				entries.reduce((sum, each) => sum + each),
			]);
			await log.append(4);

			expect(await log.replay()).toEqual([6, 4]);
		});

		it("leaves a log alone when compacting would not shorten it", async () => {
			const log = (await open()).log<number>("log.jsonl");
			await log.append(1, 2);

			await log.compact((entries) => [...entries, 3]);

			expect(await log.replay()).toEqual([1, 2]);
		});

		it("moves its entries into a segment on rotating", async () => {
			const log = (await open()).log<number>("log.jsonl", { segments: "log" });
			await log.append(1, 2);

			const segment = await rotated(log);
			await log.append(3);

			expect(await log.replay()).toEqual([3]);
			expect(await log.segments()).toEqual([segment]);
			expect(await log.replaySegment(segment)).toEqual([1, 2]);
		});

		it("rotates nothing when nothing was appended", async () => {
			const log = (await open()).log("log.jsonl");

			expect(await log.rotate()).toBeNull();
			expect(await log.segments()).toEqual([]);
		});

		it("drops a segment, and everything on removal", async () => {
			const log = (await open()).log<number>("log.jsonl");
			await log.append(1);
			const first = await rotated(log);
			await log.append(2);
			await log.rotate();
			await log.append(3);

			await log.dropSegment(first);
			expect(await log.segments()).toHaveLength(1);
			await log.remove();

			expect(await log.replay()).toEqual([]);
			expect(await log.segments()).toEqual([]);
		});
	});

	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("collection", () => {
		it("keeps records and blobs by name, listed sorted", async () => {
			const tasks = (await open()).collection("tasks");

			await tasks.write("2.md", "second");
			await tasks.write("1.md", "first");
			await tasks.writeBytes("shot.png", new Uint8Array([1, 2, 3]));

			expect(await tasks.list()).toEqual(["1.md", "2.md", "shot.png"]);
			expect(await tasks.read("1.md")).toBe("first");
			expect(await tasks.readBytes("shot.png")).toEqual(
				new Uint8Array([1, 2, 3]),
			);
			expect(await tasks.read("3.md")).toBeNull();
			expect(await tasks.readBytes("3.md")).toBeNull();
		});

		it("lists, sizes and removes what is nested under a key", async () => {
			const storage = await open();
			await storage.collection("conversations/a/artifacts").write("x", "four");
			await storage.collection("conversations/b").write("y", "ab");
			await storage.collection("conversations/b/attached").write("z", "abc");

			expect(await storage.children("conversations")).toEqual(["a", "b"]);
			expect(await storage.children("conversations/b")).toEqual(["attached"]);
			expect(await storage.size("conversations")).toBe(9);

			await storage.remove("conversations/b");

			expect(await storage.children("conversations")).toEqual(["a"]);
			expect(await storage.size("conversations")).toBe(4);
			expect(await storage.size("nothing")).toBe(0);
		});

		it("tells the bytes of each name held", async () => {
			const files = (await open()).collection("files");
			await files.write("a.txt", "four");
			await files.writeBytes("b.bin", new Uint8Array(6));

			expect(await files.entries()).toEqual([
				{ name: "a.txt", size: 4 },
				{ name: "b.bin", size: 6 },
			]);
		});

		it("sizes what it holds", async () => {
			const files = (await open()).collection("files");

			await files.write("a.txt", "four");
			await files.writeBytes("b.bin", new Uint8Array(6));

			expect(await files.size()).toBe(10);
		});

		it("leaves out a nested collection", async () => {
			const storage = await open();
			await storage.collection("tasks").write("7.md", "task");

			await storage
				.collection("tasks/7")
				.writeBytes("shot.png", new Uint8Array(1));

			expect(await storage.collection("tasks").list()).toEqual(["7.md"]);
		});

		it("removes one, then all", async () => {
			const tasks = (await open()).collection("tasks");
			await tasks.write("1.md", "first");
			await tasks.write("2.md", "second");

			await tasks.remove("1.md");
			expect(await tasks.list()).toEqual(["2.md"]);
			await tasks.clear();

			expect(await tasks.list()).toEqual([]);
			expect(await tasks.size()).toBe(0);
		});

		it("refuses a name that is a path", async () => {
			const tasks = (await open()).collection("tasks");

			expect(tasks.write("../push.json", "{}")).rejects.toThrow(
				"not a name in a collection",
			);
		});
	});

	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("keys", () => {
		it("refuses one that leaves the storage", async () => {
			const storage = await open();

			expect(() => storage.document("../elsewhere.json")).toThrow(
				"not a storage key",
			);
		});

		it("reads within a key what the whole storage has under it", async () => {
			const storage = await open();
			await storage.document("projects/a/push.json").write({ on: true });

			const project = storage.within("projects/a");

			expect(await project.document("push.json").read()).toEqual({ on: true });
		});
	});

	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("copies", () => {
		let storage: Storage;
		beforeEach(async () => {
			storage = await open();
		});

		it("lists every key holding something, sorted, locks left out", async () => {
			await storage.document("hooks.json").update(() => ({ on: true }));
			const log = storage.log("a.jsonl");
			await log.append({ n: 1 });
			const { name } = await rotated(log);
			await log.append({ n: 2 });

			expect(await storage.keys("")).toEqual([
				"a.jsonl",
				`a.jsonl.segments/${name}`,
				"hooks.json",
			]);
		});

		it("lists the keys under one, relative to the storage", async () => {
			await storage.collection("tasks").write("1.md", "first");
			await storage.document("hooks.json").write({});

			expect(await storage.within("tasks").keys("")).toEqual(["1.md"]);
			expect(await storage.keys("tasks")).toEqual(["tasks/1.md"]);
		});

		it("copies a value's bytes", async () => {
			const blob = new Uint8Array([0, 1, 255]);
			await storage.collection("files").writeBytes("a.png", blob);

			expect(await storage.copy("files/a.png")).toEqual({
				kind: "value",
				bytes: blob,
			});
		});

		it("copies a log's lines after the ones skipped", async () => {
			await storage.log("conversations/a.jsonl").append({ n: 1 }, { n: 2 });

			expect(await storage.copy("conversations/a.jsonl", 1)).toEqual({
				kind: "log",
				lines: ['{"n":2}'],
				count: 2,
			});
		});

		it("copies a segment as a log", async () => {
			const log = storage.log("conversations/a.jsonl");
			await log.append({ n: 1 });

			const { name } = await rotated(log);

			expect(
				await storage.copy(`conversations/a.jsonl.segments/${name}`),
			).toEqual({
				kind: "log",
				lines: ['{"n":1}'],
				count: 1,
			});
		});

		it("copies nothing where nothing is", async () => {
			expect(await storage.copy("tasks/1.md")).toBeNull();
		});
	});

	// scry-ignore simple-test-setup: one contract suite per kind of primitive, each opening its own storage through `open`, the backends being the outer describe
	describe("watch", () => {
		// scry-ignore simple-test-setup: only the watch cases subscribe before writing; the others take no subscription
		it("tells of a write under the key, relative to the storage", async () => {
			const storage = await open();
			const tasks = storage.collection("tasks");
			await tasks.write("1.md", "first");
			const watch = storage.watch("tasks");
			const told = new Promise<string>((resolve) =>
				watch.events.on(
					"changed",
					(key) => key === "tasks/1.md" && resolve(key),
				),
			);

			// A native watcher can take a moment to become ready, and a write
			// before then goes unseen, so write again until it tells.
			let settled = false;
			void told.then(() => {
				settled = true;
			});
			// scry-ignore matchers-over-test-logic: a native watcher has no ready signal, so the write repeats until it tells
			for (let i = 0; !settled && i < 100; i++) {
				await tasks.write("1.md", `again ${i}`);
				await Bun.sleep(50);
			}

			expect(await told).toBe("tasks/1.md");
			watch.dispose();
		});

		// scry-ignore simple-test-setup: only the watch cases subscribe before writing; the others take no subscription
		it("does not tell of a lock taken beside the key", async () => {
			const storage = await open();
			const tasks = storage.collection("tasks");
			await tasks.write("1.md", "first");
			const watch = storage.watch("tasks");
			const keys: string[] = [];
			watch.events.on("changed", (key) => keys.push(key));
			const lock = storage.lock("tasks.lock");

			// Write until the watcher is ready, taking the lock each time, so
			// the write is told and the lock is seen if it ever will be.
			// scry-ignore matchers-over-test-logic: a native watcher has no ready signal, so the write repeats until it tells
			for (let i = 0; !keys.includes("tasks/1.md") && i < 100; i++) {
				await lock.acquire();
				await tasks.write("1.md", `again ${i}`);
				await lock.release();
				await Bun.sleep(50);
			}

			expect(keys).toContain("tasks/1.md");
			expect(keys.filter((key) => key.includes(".lock"))).toEqual([]);
			watch.dispose();
		});
	});
});

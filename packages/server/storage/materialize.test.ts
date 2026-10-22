import { describe, expect, it } from "bun:test";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { FsStorage, SqliteStorage, type Storage } from "./index";
import { MemoryStorage } from "./testing";

// An agent reads what it is handed as a file, whichever backend keeps it.
describe.each([
	{
		backend: "memory with a cache",
		open: (fs: FakeFs): Storage => MemoryStorage.cachedIn("/cache", fs),
	},
	{
		backend: "a fake disk",
		open: (fs: FakeFs): Storage => new FsStorage("/home/s", fs),
	},
	{
		backend: "sqlite with a cache",
		open: (fs: FakeFs): Storage =>
			SqliteStorage.open(":memory:", { fs, ps: new FakePs(), cache: "/cache" }),
	},
])("materialize on $backend", ({ open }) => {
	it("gives a path a blob and a log read back from", async () => {
		const fs = new FakeFs();
		const storage = open(fs);
		await storage.collection("c1").writeBytes("a.bin", new Uint8Array([1, 2]));
		await storage.log<{ n: number }>("c1.jsonl").append({ n: 1 });

		expect(await fs.readBytes(await storage.materialize("c1/a.bin"))).toEqual(
			new Uint8Array([1, 2]),
		);
		expect(await fs.read(await storage.materialize("c1.jsonl"))).toBe(
			'{"n":1}\n',
		);
	});
});

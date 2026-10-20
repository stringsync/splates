import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { MemoryStorage } from "../storage/testing";
import { Attachments } from "./attachments";

describe("Attachments in a storage with no files", () => {
	it("hands out copies in the cache, which it owns and removes", async () => {
		const fs = new FakeFs();
		const files = new Attachments(
			MemoryStorage.cachedIn("/cache", fs),
			"tasks/7/started",
			new CounterIdProvider(),
		);
		const [path] = await files.store([
			{ name: "a.png", bytes: new Uint8Array([1, 2]) },
		]);
		expect(path?.startsWith("/cache/")).toBe(true);
		expect([...(await fs.readBytes(path as string))]).toEqual([1, 2]);
		expect((await files.held()).map((file) => file.path)).toEqual([
			path as string,
		]);
		expect(await files.owns(path as string)).toBe(true);
		expect(await files.owns("/cache/elsewhere/a.png")).toBe(false);
		await files.remove([path as string]);
		expect(await files.held()).toEqual([]);
	});
});

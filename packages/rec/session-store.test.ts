import { expect, test } from "bun:test";
import { MemoryLogger } from "core/log";
import { FakeFs } from "core/system/testing";
import { SessionStore } from "./session-store";

test("evicts by start time regardless of name, counts nested files, and keeps the saved session", async () => {
	const fs = new FakeFs();
	const log = new MemoryLogger();
	// vet-ignore matchers-over-test-logic: seed three dated session trees to verify chronological eviction
	for (const [name, startedAt] of [
		["zebra", 1],
		["alpha", 2],
		["saved", 3],
	] as const) {
		await fs.mkdir(`/store/${name}/frames`, { recursive: true });
		await fs.write(
			`/store/${name}/manifest.json`,
			JSON.stringify({ startedAt, name }),
		);
		await fs.write(`/store/${name}/frames/image`, "x".repeat(100));
	}
	await fs.mkdir("/outside", { recursive: true });
	await fs.write("/outside/recording", "leave me");
	await new SessionStore(fs, log, "/store", { limit: 300 }).prune(
		"/store/saved",
	);
	expect(await fs.exists("/store/zebra")).toBe(false);
	expect(await fs.exists("/store/alpha")).toBe(true);
	expect(await fs.exists("/store/saved")).toBe(true);
	expect(await fs.read("/outside/recording")).toBe("leave me");
});

test("keeps an oversized saved session and unfinished recordings", async () => {
	const fs = new FakeFs();
	await fs.mkdir("/store/saved", { recursive: true });
	await fs.write("/store/saved/manifest.json", '{"startedAt":1}');
	await fs.mkdir("/store/unfinished", { recursive: true });
	await fs.write("/store/unfinished/recording", "still recording");
	await new SessionStore(fs, new MemoryLogger(), "/store", { limit: 1 }).prune(
		"/store/saved",
	);
	expect(await fs.exists("/store/saved")).toBe(true);
	expect(await fs.exists("/store/unfinished/recording")).toBe(true);
});

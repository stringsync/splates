import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "webappwiz/system";
import { KeyFileStore } from "./key-file";

describe("KeyFileStore", () => {
	let dir: string;
	let store: KeyFileStore;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-key-file-"));
		store = new KeyFileStore(join(dir, "home", "worker.env"), new NodeFs());
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("keeps values in a file only its user may read", async () => {
		await store.set("SPLATES_WORKER_KEY", "the-key");

		expect(await store.get("SPLATES_WORKER_KEY")).toBe("the-key");
		expect((await stat(store.path)).mode & 0o777).toBe(0o600);
	});

	it("keeps each value beside the rest, and deletes one alone", async () => {
		await store.set("A", "1");
		await store.set("B", "x=y");

		expect(await store.delete("A")).toBe(true);
		expect(await store.delete("A")).toBe(false);
		expect(await store.names()).toEqual(["B"]);
		expect(await store.get("B")).toBe("x=y");
	});

	it("has nothing before the file is made", async () => {
		expect(await store.get("SPLATES_WORKER_KEY")).toBeUndefined();
	});
});

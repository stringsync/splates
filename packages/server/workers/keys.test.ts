import { describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { FakeFs } from "webappwiz/system/testing";
import { WorkerKeys } from "./keys";

const PATH = "/home/.splates/worker-keys.json";

describe("WorkerKeys", () => {
	it("keeps a worker's key in the store and only its name on the roster", async () => {
		const store = new FakeSecretStore();
		const fs = new FakeFs();
		const keys = await WorkerKeys.open(PATH, fs, store);

		const key = await keys.add({ worker: "home-pc" }, "anthropic", " sk-ant ");

		expect(key.cred).toBe("SPLATES_ANTHROPIC_KEY_WORKER_HOME_PC");
		expect(store.values.get(key.cred)).toBe("sk-ant");
		expect(await keys.value(key)).toBe("sk-ant");
		expect(await fs.read(PATH)).not.toContain("sk-ant");
		const again = await WorkerKeys.open(PATH, fs, store);
		expect(again.all).toEqual([key]);
	});

	it("replaces a holder's key under the same name", async () => {
		const store = new FakeSecretStore();
		const keys = WorkerKeys.memory(store);
		const first = await keys.add({ worker: "box" }, "openai", "one");

		const second = await keys.add({ worker: "box" }, "openai", "two");

		expect(second.cred).toBe(first.cred);
		expect(keys.all).toHaveLength(1);
		expect(store.values.get(first.cred)).toBe("two");
	});

	it("names two ids that read alike apart", async () => {
		const keys = WorkerKeys.memory(new FakeSecretStore());

		const one = await keys.add({ worker: "home-pc" }, "anthropic", "a");
		const other = await keys.add({ worker: "home_pc" }, "anthropic", "b");

		expect(other.cred).toBe(`${one.cred}_2`);
	});

	it("says a worker holds its type's key unless it has its own", async () => {
		const keys = WorkerKeys.memory(new FakeSecretStore());
		await keys.add({ type: "small" }, "anthropic", "typed");
		await keys.add({ worker: "small-1" }, "anthropic", "own");

		const made = { id: "small-1", type: "small" };
		const other = { id: "small-2", type: "small" };
		const joined = { id: "box", type: null };

		expect(keys.of(made).map((each) => each.holder)).toEqual([
			{ worker: "small-1" },
		]);
		expect(keys.holds(other, "claude")).toBe(true);
		expect(keys.holds(joined, "claude")).toBe(false);
		expect(keys.holds(joined, "codex")).toBe(false);
		expect(keys.typeHolds("small", "claude")).toBe(true);
		expect(keys.typeHolds("large", "claude")).toBe(false);
	});

	it("holds an agent no provider's key is for", () => {
		const keys = WorkerKeys.memory(new FakeSecretStore());

		expect(keys.holds({ id: "box", type: null }, "opencode")).toBe(true);
	});

	it("deletes a removed worker's own keys and leaves its type's", async () => {
		const store = new FakeSecretStore();
		const keys = WorkerKeys.memory(store);
		const own = await keys.add({ worker: "small-1" }, "anthropic", "own");
		const typed = await keys.add({ type: "small" }, "anthropic", "typed");

		expect(await keys.forget("small-1")).toEqual([own]);

		expect(keys.all).toEqual([typed]);
		expect(store.values.has(own.cred)).toBe(false);
	});

	it("removes one key, answering whether there was one", async () => {
		const store = new FakeSecretStore();
		const keys = WorkerKeys.memory(store);
		const key = await keys.add({ worker: "box" }, "openai", "k");

		expect(await keys.remove({ worker: "box" }, "openai")).toBe(true);
		expect(await keys.remove({ worker: "box" }, "openai")).toBe(false);
		expect(store.values.has(key.cred)).toBe(false);
	});

	it("refuses a provider it does not know, or no value", async () => {
		const keys = WorkerKeys.memory(new FakeSecretStore());

		await expect(keys.add({ worker: "box" }, "acme", "k")).rejects.toThrow(
			"no provider acme",
		);
		await expect(keys.add({ worker: "box" }, "openai", " ")).rejects.toThrow(
			"nothing kept",
		);
	});
});

import { beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { WORKER_KEY, workerKey } from "./run";

describe("workerKey", () => {
	let store: FakeSecretStore;
	let log: MemoryLogger;
	let sent: unknown[];

	beforeEach(() => {
		store = new FakeSecretStore();
		log = new MemoryLogger();
		sent = [];
	});

	it("joins with the token and keeps the key in the store, never the log", async () => {
		const key = await workerKey("box", {
			coordinator: "https://splates.example.com",
			slots: 2,
			id: "box",
			join: "splj_token",
			log,
			ps: new FakePs(),
			fs: new NodeFs(),
			store,
			send: (async (_url: string, init?: RequestInit) => {
				sent.push(JSON.parse(String(init?.body)));
				return Response.json({ id: "box", key: "the-key" });
			}) as unknown as typeof fetch,
		});

		expect(key).toBe("the-key");
		expect(sent).toEqual([{ token: "splj_token", id: "box" }]);
		expect(await store.get(WORKER_KEY)).toBe("the-key");
		expect(JSON.stringify(log.entries)).not.toContain("the-key");
	});
});

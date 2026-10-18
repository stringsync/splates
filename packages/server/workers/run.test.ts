import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { joinToken } from "./access";
import {
	WORKER_ACCESS_ID,
	WORKER_ACCESS_SECRET,
	WORKER_KEY,
	type WorkerRunOptions,
	workerCreds,
	workerKeyFile,
} from "./run";

describe("workerCreds", () => {
	let store: FakeSecretStore;
	let log: MemoryLogger;
	let sent: { url: string; headers: Headers; body: unknown }[];
	let dir: string;
	let ps: FakePs;
	const access = { clientId: "client.access", clientSecret: "secret" };

	beforeEach(async () => {
		store = new FakeSecretStore();
		log = new MemoryLogger();
		sent = [];
		dir = await mkdtemp(join(tmpdir(), "splates-run-"));
		ps = new FakePs();
		ps.setEnv({ SPLATES_HOME: dir });
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	function options(join: string): WorkerRunOptions {
		return {
			coordinator: "https://splates.example.com",
			slots: 2,
			id: "box",
			join,
			log,
			ps,
			fs: new NodeFs(),
			store,
			send: (async (url: URL, init?: RequestInit) => {
				sent.push({
					url: String(url),
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
				});
				return Response.json({ id: "box", key: "the-key" });
			}) as unknown as typeof fetch,
		};
	}

	it("joins with the token and keeps the key in the store, never the log", async () => {
		const creds = await workerCreds("box", options("splj_token"));

		expect(creds).toEqual({ key: "the-key", access: null });
		expect(sent).toMatchObject([
			{
				url: "https://splates.example.com/api/workers/join",
				body: { token: "splj_token", id: "box" },
			},
		]);
		expect(sent[0]?.headers.has("cf-access-client-id")).toBe(false);
		expect(await store.get(WORKER_KEY)).toBe("the-key");
		expect(JSON.stringify(log.entries)).not.toContain("the-key");
	});

	it("passes Access with the service token its join token carries, and keeps it for each dial after", async () => {
		const token = joinToken("splj_token", access);

		const joined = await workerCreds("box", options(token));

		expect(joined.access).toEqual(access);
		expect(sent[0]?.headers.get("cf-access-client-id")).toBe("client.access");
		expect(sent[0]?.headers.get("cf-access-client-secret")).toBe("secret");
		expect(sent[0]?.body).toEqual({ token, id: "box" });
		expect(await store.get(WORKER_ACCESS_ID)).toBe("client.access");
		expect(await store.get(WORKER_ACCESS_SECRET)).toBe("secret");
		expect(await workerCreds("box", options(""))).toEqual({
			key: "the-key",
			access,
		});
		expect(JSON.stringify(log.entries)).not.toContain("secret");
	});

	it("keeps the key and service token in memory alone for an ephemeral machine", async () => {
		const joined = await workerCreds("box", {
			...options(joinToken("splj_token", access)),
			ephemeral: true,
		});

		expect(joined).toEqual({ key: "the-key", access });
		expect(sent[0]?.url).toBe("https://splates.example.com/api/workers/join");
		expect(await store.get(WORKER_KEY)).toBeUndefined();
		expect(await store.get(WORKER_ACCESS_ID)).toBeUndefined();
	});

	it("keeps the key for this run alone where the store cannot keep it", async () => {
		store.set = async () => {
			throw new Error("no secret service");
		};

		const creds = await workerCreds("box", options("splj_token"));

		expect(creds).toEqual({ key: "the-key", access: null });
		expect(JSON.stringify(log.entries)).toContain("this run only");
		expect(JSON.stringify(log.entries)).not.toContain("the-key");
	});

	it("keeps the key it joins with in the key file, and reads it there on the next run", async () => {
		const keyFile = (token: string): WorkerRunOptions => ({
			...options(token),
			store: undefined,
			keyFile: true,
		});

		await workerCreds("box", keyFile("splj_token"));

		expect(await Bun.file(workerKeyFile(ps)).text()).toContain(
			`${WORKER_KEY}=the-key`,
		);
		expect(await workerCreds("box", keyFile(""))).toEqual({
			key: "the-key",
			access: null,
		});
	});
});

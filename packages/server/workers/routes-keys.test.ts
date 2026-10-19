// scry-ignore-file simple-test-setup: its imports moved to server/; it predates the rule
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../server/shared";
import { FakeWorkerProvider } from "../workers/testing";
import {
	type RemoteWorker,
	Snapshots,
	WebSocketWorkerSocket,
	WorkerBudget,
	WorkerDaemon,
	WorkerKeys,
} from "./index";
import { DevWorkers, workerAuthorization } from "./routes";

describe("DevWorkers' API keys", () => {
	let store: FakeSecretStore;
	let provider: FakeWorkerProvider;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;

	beforeEach(async () => {
		store = new FakeSecretStore();
		provider = new FakeWorkerProvider();
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				workers.open(request, server) ??
				new Response("not found", { status: 404 }),
		});
		workers = new DevWorkers(new MemoryLogger(), {
			keys: WorkerKeys.memory(store),
			provider: {
				provider,
				snapshots: await Snapshots.open(provider, {
					version: "1.0.0",
					document: null,
				}),
				coordinator: () => `http://127.0.0.1:${server.port}`,
				budget: WorkerBudget.memory(),
			},
		});
		// This machine's worker, which needs no key, takes nothing.
		await workers.update(
			new Request("http://127.0.0.1/api/workers/local", {
				method: "PUT",
				body: JSON.stringify({ draining: true }),
			}),
		);
	});

	afterEach(async () => {
		await workers.disposeAsync();
		server.stop(true);
	});

	it("keeps a worker's key in the store, listing whose it is and never its value", async () => {
		await joinedKey(workers, "box");

		const added = await keyed(workers, "PUT", {
			provider: "anthropic",
			worker: "box",
			value: "sk-ant-secret",
		});

		expect(added.status).toBe(200);
		expect([...store.values.values()]).toEqual(["sk-ant-secret"]);
		const listed = await (await keyed(workers, "GET")).text();
		expect(listed).not.toContain("sk-ant-secret");
		expect(JSON.parse(listed)).toMatchObject({
			keys: [{ provider: "anthropic", holder: { worker: "box" } }],
			holders: { workers: ["box"], types: ["small"] },
		});
		const { workers: shown } = await (await workers.list()).json();
		expect(
			shown.find((each: { id: string }) => each.id === "box").keys,
		).toEqual(["anthropic"]);
	});

	it("refuses a key for this machine's worker, a worker it does not know, or a provider it does not", async () => {
		const asked = [
			{ provider: "anthropic", worker: "local", value: "k" },
			{ provider: "anthropic", worker: "nobody", value: "k" },
			{ provider: "acme", type: "small", value: "k" },
		];

		const statuses = await Promise.all(
			asked.map(async (body) => (await keyed(workers, "PUT", body)).status),
		);

		expect(statuses).toEqual([404, 404, 400]);
		expect(store.values.size).toBe(0);
	});

	it("deletes a key", async () => {
		await keyed(workers, "PUT", {
			provider: "openai",
			type: "small",
			value: "sk-proj",
		});

		const removed = await keyed(
			workers,
			"DELETE",
			"?provider=openai&type=small",
		);

		expect(removed.status).toBe(200);
		expect(store.values.size).toBe(0);
		expect(
			(await keyed(workers, "DELETE", "?provider=openai&type=small")).status,
		).toBe(404);
	});

	it("queues an agent until a worker holds its key, then places it there", async () => {
		const key = await joinedKey(workers, "box");
		const joined = new Promise<RemoteWorker>((resolve) =>
			workers.registry.events.on("joined", resolve, { once: true }),
		);
		const daemon = dialing(server, "box", key);
		void daemon.run();
		await joined;
		// No type holds one either, so none is made for it.
		const placed = workers.slots.scheduler.take(request("one"));
		await Bun.sleep(10);

		expect(workers.slots.scheduler.spot("one")?.reason).toBe(
			"needs a key for claude",
		);
		expect(provider.specs).toEqual([]);
		await keyed(workers, "PUT", {
			provider: "anthropic",
			worker: "box",
			value: "sk-ant",
		});
		expect((await placed).worker).toBe("box");
		await daemon.disposeAsync();
	});

	it("makes a worker for a queued agent only of a type that holds its key", async () => {
		void workers.slots.scheduler.take(request("one")).catch(() => {});
		await Bun.sleep(10);
		expect(provider.specs).toEqual([]);

		await keyed(workers, "PUT", {
			provider: "anthropic",
			type: "small",
			value: "sk-ant",
		});
		await Bun.sleep(10);

		expect(provider.specs.map((each) => each.type)).toEqual(["small"]);
	});

	it("forgets a removed worker's own keys", async () => {
		await joinedKey(workers, "box");
		await keyed(workers, "PUT", {
			provider: "anthropic",
			worker: "box",
			value: "sk-ant",
		});

		await workers.remove(
			new Request("http://127.0.0.1/api/workers/box", { method: "DELETE" }),
		);

		expect(workers.keys?.all).toEqual([]);
		expect(store.values.size).toBe(0);
	});
});

/** Asks `/api/workers/keys` with `method`, sending `body`, or a query for a string. */
function keyed(
	workers: DevWorkers,
	method: string,
	body?: unknown,
): Promise<Response> {
	const query = typeof body === "string" ? body : "";
	return workers.manage(
		new Request(`http://127.0.0.1/api/workers/keys${query}`, {
			method,
			...(body === undefined || typeof body === "string"
				? {}
				: { body: JSON.stringify(body) }),
		}),
		(handle) => handle,
	);
}

/** Lets worker `id` join `workers`, answering its key. */
async function joinedKey(workers: DevWorkers, id: string): Promise<string> {
	const key = await workers.records.join(
		(await workers.records.invite()).token,
		id,
	);
	workers.registry.expect(id);
	if (key === null) {
		throw new Error("the token was refused");
	}
	return key;
}

function request(id: string) {
	return {
		id,
		task: `${id}-task`,
		agent: "claude",
		project: "/repo",
		platform: null,
	};
}

/** A worker going by `id` that dials `server` showing `key`, and makes its own checkouts. */
function dialing(
	server: Bun.Server<Connection>,
	id: string,
	key: string,
): WorkerDaemon {
	const url = `ws://127.0.0.1:${server.port}/api/workers`;
	const headers = { authorization: workerAuthorization(id, key) };
	return new WorkerDaemon(
		{ where: url, dial: () => WebSocketWorkerSocket.connect(url, headers) },
		{
			id,
			slots: 4,
			ps: new NodePs(),
			fs: new NodeFs(),
			log: new MemoryLogger(),
			backoff: { min: Duration.ms(20), max: Duration.ms(100) },
		},
	);
}

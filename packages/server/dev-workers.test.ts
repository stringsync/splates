import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { printed } from "./agent-process-testing";
import { CONNECTIONS, type Connection } from "./dev-sockets";
import { DevWorkers, workerAuthorization } from "./dev-workers";
import type { RemoteWorker } from "./remote-worker";
import { WebSocketWorkerSocket } from "./websocket-worker-socket";
import { WorkerDaemon } from "./worker-daemon";

describe("DevWorkers", () => {
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;

	beforeEach(() => {
		workers = new DevWorkers(new MemoryLogger());
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				workers.open(request, server) ??
				new Response("not found", { status: 404 }),
		});
	});

	afterEach(async () => {
		await workers.disposeAsync();
		server.stop(true);
	});

	// scry-ignore simple-test-setup: it alone runs a daemon; the others only knock
	it("takes a worker in over /api/workers and gives it work", async () => {
		const joined = new Promise<RemoteWorker>((resolve) =>
			workers.registry.events.on("joined", resolve, { once: true }),
		);
		const key = await joinedKey(workers, "remote");
		const daemon = dialing(server, "remote", key);
		void daemon.run();
		const worker = await joined;
		const child = worker.start(["echo", "over a websocket"], "/");

		expect(await printed(child)).toBe("over a websocket\n");
		await daemon.disposeAsync();
	});

	it("refuses a worker that shows no key", async () => {
		const answer = await fetch(`http://127.0.0.1:${server.port}/api/workers`, {
			headers: { upgrade: "websocket" },
		});

		expect(answer.status).toBe(401);
	});

	it("refuses a worker showing a key it did not join with", async () => {
		await joinedKey(workers, "box");
		const answer = await fetch(`http://127.0.0.1:${server.port}/api/workers`, {
			headers: {
				upgrade: "websocket",
				authorization: workerAuthorization("box", "guessed"),
			},
		});

		expect(answer.status).toBe(401);
	});

	it("hangs up on a worker whose hello names another than its key", async () => {
		const key = await joinedKey(workers, "box");
		const daemon = dialing(server, "impostor", key, "box");
		void daemon.run();
		await Bun.sleep(200);

		expect(workers.registry.worker("impostor")).toBeUndefined();
		expect(workers.registry.worker("box")?.connected).toBe(false);
		await daemon.disposeAsync();
	});

	it("lets a join token be spent once", async () => {
		const { token } = await workers.records.invite();
		const join = () =>
			workers.join(
				new Request("http://127.0.0.1/api/workers/join", {
					method: "POST",
					body: JSON.stringify({ token, id: "box" }),
				}),
			);

		expect((await join()).status).toBe(200);
		expect((await join()).status).toBe(401);
		expect(workers.registry.worker("box")).toBeDefined();
	});

	it("places nothing new on a drained worker", async () => {
		await workers.update(put("local", { draining: true }));
		const placed = workers.slots.scheduler.take(request("one"));
		let settled = false;
		void placed.then(() => {
			settled = true;
		});
		await Bun.sleep(10);

		expect(settled).toBe(false);
		expect(workers.slots.scheduler.queue()).toHaveLength(1);
		await workers.update(put("local", { draining: false }));
		expect((await placed).worker).toBe("local");
	});

	it("removes a worker once its agents end, and at once with --force", async () => {
		await joinedKey(workers, "box");
		await joinedKey(workers, "other");
		const held = workers.slots.scheduler.hold(request("one"), "box");
		workers.slots.scheduler.hold(request("two"), "other");

		const waiting = await (await workers.remove(del("box"))).json();
		expect(waiting).toMatchObject({ removed: false, running: ["one-task"] });
		expect(workers.records.of("box")?.removing).toBe(true);
		held.dispose();
		await Bun.sleep(10);
		expect(workers.registry.worker("box")).toBeUndefined();
		expect(workers.records.of("box")).toBeUndefined();

		const forced = await (await workers.remove(del("other", true))).json();
		expect(forced).toMatchObject({ removed: true, running: ["two-task"] });
		expect(workers.slots.used().get("other")).toBeUndefined();
	});

	it("will not remove this machine's own worker", async () => {
		expect((await workers.remove(del("local"))).status).toBe(400);
	});
	it("refuses a page trying to connect a worker", async () => {
		const answer = await fetch(`http://127.0.0.1:${server.port}/api/workers`, {
			headers: { origin: "https://evil.example", upgrade: "websocket" },
		});

		expect(answer.status).toBe(403);
	});
});

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
	return { id, task: `${id}-task`, project: "/repo", platform: null };
}

function put(id: string, body: unknown): Request {
	return new Request(`http://127.0.0.1/api/workers/${id}`, {
		method: "PUT",
		body: JSON.stringify(body),
	});
}

function del(id: string, force = false): Request {
	return new Request(
		`http://127.0.0.1/api/workers/${id}${force ? "?force" : ""}`,
		{ method: "DELETE" },
	);
}

/**
 * A worker going by `id` that dials `server` showing `key` as the key of
 * `keyOf`, its own id by default.
 */
function dialing(
	server: Bun.Server<Connection>,
	id: string,
	key: string,
	keyOf = id,
): WorkerDaemon {
	const url = `ws://127.0.0.1:${server.port}/api/workers`;
	const headers = { authorization: workerAuthorization(keyOf, key) };
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

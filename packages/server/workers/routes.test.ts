import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { printed } from "../agents/testing";
import { CONNECTIONS, type Connection, RUNNING } from "../server/shared";
import type { RemoteWorker } from "./index";
import { WebSocketWorkerSocket, WorkerDaemon } from "./index";
import { WorkerProtocol } from "./protocol";
import { DevWorkers, workerAuthorization } from "./routes";

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

	it("hangs up on a worker that shows no key in its upgrade or its hello", async () => {
		const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/workers`);
		const closed = new Promise<void>((resolve) =>
			socket.addEventListener("close", () => resolve()),
		);
		await new Promise<void>((resolve) =>
			socket.addEventListener("open", () => resolve()),
		);
		socket.send(
			JSON.stringify({
				type: "hello",
				protocol: WorkerProtocol.version,
				capabilities: [],
				id: "box",
				info: {},
				session: "s",
				held: [],
			}),
		);

		await closed;

		expect(workers.registry.worker("box")?.connected ?? false).toBe(false);
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
				new Request("http://127.0.0.1/api/workers", {
					method: "POST",
					body: JSON.stringify({ token, id: "box" }),
				}),
			);

		expect((await join()).status).toBe(200);
		expect((await join()).status).toBe(401);
		expect(workers.registry.worker("box")).toBeDefined();
	});

	it("routes `splates worker add`'s invite and `worker run --join`'s join", async () => {
		const pass = (handle: (request: Request) => Promise<Response>) => handle;
		const invited = await workers.manage(
			new Request("http://127.0.0.1/api/workers/invite", { method: "POST" }),
			pass,
		);
		const { token } = (await invited.json()) as { token: string };
		const joined = await workers.manage(
			new Request("http://127.0.0.1/api/workers/join", {
				method: "POST",
				body: JSON.stringify({ token, id: "box" }),
			}),
			pass,
		);

		expect(joined.status).toBe(200);
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
		const forcing = workers.slots.scheduler.hold(request("two"), "other");

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
		// Which tells its conversation to carry on elsewhere.
		expect(forcing.lost.aborted).toBe(true);
		expect(held.lost.aborted).toBe(false);
	});

	it("lists the build it runs beside the workers, as each set by hand", async () => {
		await workers.update(put("local", { slots: 3, draining: true }));
		const listed = await (await workers.list()).json();

		expect(listed).toMatchObject({
			build: RUNNING,
			workers: [{ id: "local", draining: true, slots: { total: 3 } }],
		});
	});

	it("removes this machine's own worker from the pool for good, keeping its process", async () => {
		await workers.update(put("local", { slots: 3 }));
		const removed = await (await workers.remove(del("local"))).json();
		expect(removed).toMatchObject({ removed: true, running: [] });

		const listed = await (await workers.list()).json();
		expect(listed.workers).toEqual([]);
		expect(workers.registry.worker("local")).toBe(workers.local);
		const placed = workers.slots.scheduler.take({
			...request("mine"),
			uncapped: true,
		});
		await Bun.sleep(10);
		expect(workers.slots.scheduler.spot("mine")?.reason).toBe("no worker up");

		const again = new DevWorkers(new MemoryLogger(), {
			records: workers.records,
		});
		expect((await (await again.list()).json()).workers).toEqual([]);
		await again.disposeAsync();

		await workers.update(put("local", { draining: false }));
		expect((await placed).worker).toBe("local");
		expect((await (await workers.list()).json()).workers).toMatchObject([
			{ id: "local", draining: false, removing: false, slots: { total: 3 } },
		]);
	});

	it("lets this machine's own agents run to their end as its worker is removed", async () => {
		const held = workers.slots.scheduler.hold(
			{ ...request("mine"), uncapped: true },
			"local",
		);
		const waiting = await (await workers.remove(del("local"))).json();
		expect(waiting).toMatchObject({ removed: false, running: ["mine-task"] });
		expect((await workers.remove(del("local", true))).status).toBe(400);

		held.dispose();
		await Bun.sleep(10);
		expect(workers.records.localOn).toBe(false);
		expect(workers.records.of("local")).toMatchObject({
			draining: false,
			removing: false,
		});
		expect((await workers.remove(del("local"))).status).toBe(404);
	});

	it("brings this machine's own worker back only to take agents again", async () => {
		await workers.remove(del("local"));
		expect(
			(await workers.update(put("local", { draining: true }))).status,
		).toBe(404);
		expect(workers.records.localOn).toBe(false);
		expect(
			(await workers.update(put("local", { slots: 2, draining: false })))
				.status,
		).toBe(200);
		expect(workers.records.localOn).toBe(true);
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
	return {
		id,
		task: `${id}-task`,
		agent: "claude",
		project: "/repo",
		platform: null,
	};
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

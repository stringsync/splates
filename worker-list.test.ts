import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "./dev-sockets";
import { DevWorkers } from "./dev-workers";
import { UnixWorkerSocket } from "./unix-worker-socket";
import { WebSocketWorkerSocket } from "./websocket-worker-socket";
import { WorkerDaemon } from "./worker-daemon";
import { listWorkers } from "./worker-list";

describe("arbor worker list", () => {
	let dir: string;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;
	let daemons: WorkerDaemon[];
	let url: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "arbor-worker-ls-"));
		workers = new DevWorkers(new MemoryLogger());
		await workers.listen(join(dir, "worker.sock"), new NodeFs());
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				request.headers.get("upgrade") === null
					? workers.list()
					: (workers.open(request, server) ??
						new Response("not found", { status: 404 })),
		});
		url = `http://localhost:${server.port}`;
		daemons = [];
	});

	afterEach(async () => {
		for (const daemon of daemons) {
			await daemon.disposeAsync();
		}
		await workers.disposeAsync();
		server.stop(true);
		await rm(dir, { recursive: true, force: true });
	});

	async function join_(
		id: string,
		slots: number,
		dial: () => Promise<UnixWorkerSocket | WebSocketWorkerSocket>,
	): Promise<void> {
		const joined = new Promise<void>((resolve) =>
			workers.registry.events.on(
				"joined",
				(worker) => worker.id === id && resolve(),
			),
		);
		const daemon = new WorkerDaemon(
			{ where: id, dial },
			{
				id,
				slots,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		daemons.push(daemon);
		void daemon.run();
		await joined;
	}

	async function ls(json: boolean): Promise<string> {
		const log = new MemoryLogger();
		await listWorkers({ dev: url, json, log, ps: new NodePs() });
		return log.entries.map((entry) => String(entry.message)).join("\n");
	}

	// scry-ignore simple-test-setup: it alone dials both a socket and a WebSocket
	it("lists a worker over the socket as local and one over /api/workers as registered", async () => {
		await join_("local", 8, () =>
			UnixWorkerSocket.connect(join(dir, "worker.sock")),
		);
		await join_("away", 2, () =>
			WebSocketWorkerSocket.connect(
				`ws://localhost:${server.port}/api/workers`,
			),
		);

		const listed = JSON.parse(await ls(true));

		expect(listed.refused).toEqual([]);
		expect(
			listed.workers.map(
				(worker: { id: string; kind: string; slots: unknown }) => [
					worker.id,
					worker.kind,
					worker.slots,
				],
			),
		).toEqual([
			["local", "local", { used: 0, total: 8 }],
			["away", "registered", { used: 0, total: 2 }],
		]);
		expect(listed.workers[0]).toMatchObject({
			health: "connected",
			tasks: [],
			dollarsPerHour: 0,
			protocol: expect.any(String),
		});
		expect(listed.workers[0].lastHeard).toBeNumber();
	});

	it("prints a table, one row a worker", async () => {
		await join_("local", 8, () =>
			UnixWorkerSocket.connect(join(dir, "worker.sock")),
		);

		const text = await ls(false);

		expect(text).toMatch(/local\s+local\s.*\s0\/8\s+connected, heard/);
	});

	it("lists the local worker as away before it joins", async () => {
		expect(await ls(false)).toMatch(/local\s+local\s.*\s0\/\?\s+away/);
	});

	it("fails when it has no arbor dev to ask", async () => {
		const asking = listWorkers({
			dev: "",
			json: false,
			log: new MemoryLogger(),
			ps: new FakePs(),
		});

		await expect(asking).rejects.toThrow("no `arbor dev` to ask");
	});
});

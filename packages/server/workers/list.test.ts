import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { FakePs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../server/shared";
import { WorkerDaemon } from "./daemon";
import { listWorkers } from "./list";
import { DevWorkers } from "./routes";
import { UnixWorkerSocket } from "./unix-socket";
import type { WebSocketWorkerSocket } from "./websocket-socket";

describe("splates worker list", () => {
	let dir: string;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;
	let daemons: WorkerDaemon[];
	let url: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-worker-ls-"));
		workers = new DevWorkers(new MemoryLogger());
		await workers.listen(join(dir, "worker.sock"), new NodeFs());
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: () => workers.list(),
		});
		url = `http://127.0.0.1:${server.port}`;
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
	it("lists this machine’s worker over its Unix socket", async () => {
		await join_("local", () =>
			UnixWorkerSocket.connect(join(dir, "worker.sock")),
		);

		const listed = JSON.parse(await ls(true));

		expect(listed.refused).toEqual([]);
		expect(
			listed.workers.map((worker: { id: string; kind: string }) => [
				worker.id,
				worker.kind,
			]),
		).toEqual([["local", "local"]]);
		expect(listed.workers[0]).toMatchObject({
			health: "connected",
			tasks: [],
			protocol: expect.any(String),
		});
		expect(listed.workers[0].lastHeard).toBeNumber();
	});

	it("prints a table, one row a worker", async () => {
		await join_("local", () =>
			UnixWorkerSocket.connect(join(dir, "worker.sock")),
		);

		const text = await ls(false);

		expect(text).toMatch(/local\s+local\s.*\s+connected, heard/);
	});

	it("lists the local worker as away before it joins", async () => {
		expect(await ls(false)).toMatch(/local\s+local\s.*\s+away/);
	});

	it("fails when it has no splates server to ask", async () => {
		const asking = listWorkers({
			dev: "",
			json: false,
			log: new MemoryLogger(),
			ps: new FakePs(),
		});

		await expect(asking).rejects.toThrow("no `splates server` to ask");
	});
});

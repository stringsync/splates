import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { printed } from "./agent-process-testing";
import { CONNECTIONS, type Connection } from "./dev-sockets";
import { DevWorkers } from "./dev-workers";
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
		const url = `ws://localhost:${server.port}/api/workers`;
		const daemon = new WorkerDaemon(
			{ where: url, dial: () => WebSocketWorkerSocket.connect(url) },
			{
				id: "remote",
				slots: 4,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void daemon.run();
		const worker = await joined;
		const child = worker.start(["echo", "over a websocket"], "/");

		expect(await printed(child)).toBe("over a websocket\n");
		await daemon.disposeAsync();
	});

	it("refuses a worker connecting through any host but this machine's", async () => {
		const answer = await fetch(`http://127.0.0.1:${server.port}/api/workers`, {
			headers: { host: "arbor.example.com", upgrade: "websocket" },
		});

		expect(answer.status).toBe(403);
	});

	it("refuses a page trying to connect a worker", async () => {
		const answer = await fetch(`http://127.0.0.1:${server.port}/api/workers`, {
			headers: { origin: "https://evil.example", upgrade: "websocket" },
		});

		expect(answer.status).toBe(403);
	});
});

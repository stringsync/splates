import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { PortForward } from "./port-forward";
import type { RemoteWorker } from "./remote-worker";
import { UnixWorkerListener } from "./unix-worker-listener";
import { UnixWorkerSocket } from "./unix-worker-socket";
import { WorkerDaemon } from "./worker-daemon";
import { WorkerRegistry } from "./worker-registry";

describe("PortForward", () => {
	let dir: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let worker: RemoteWorker;
	let app: Bun.Server<undefined>;
	let forwards: PortForward[];
	const forwarding = (...args: Parameters<typeof PortForward.listen>) => {
		const forward = PortForward.listen(...args);
		forwards.push(forward);
		return forward;
	};

	beforeEach(async () => {
		forwards = [];
		dir = await mkdtemp(join(tmpdir(), "arbor-port-"));
		const path = join(dir, "worker.sock");
		registry = new WorkerRegistry(new MemoryLogger());
		listener = await UnixWorkerListener.listen(path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		daemon = new WorkerDaemon(
			{ where: path, dial: () => UnixWorkerSocket.connect(path) },
			{
				id: "mac",
				slots: 8,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				session: { bufferBytes: 64 * 1024 },
			},
		);
		void daemon.run();
		worker = await joined;
		// The task's dev server, on the worker's loopback.
		app = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: async (request, server) =>
				server.upgrade(request)
					? undefined
					: new Response(
							`${request.method} ${new URL(request.url).pathname} ${(await request.text()).length}`,
						),
			websocket: {
				message: (socket, message) => {
					socket.send(`echo ${message}`);
				},
			},
		});
	});

	afterEach(async () => {
		for (const forward of forwards) {
			forward.dispose();
		}
		await app.stop(true);
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
	});

	it("finds the app among the ports the worker's processes listen on", async () => {
		expect(await worker.listening()).toContainEqual({
			pid: process.pid,
			host: "127.0.0.1",
			port: app.port as number,
			cwd: process.cwd(),
		});
	});

	it("serves the worker's port over HTTP on a loopback port of its own", async () => {
		const forward = forwarding(worker, app.port as number);

		const response = await fetch(`http://127.0.0.1:${forward.local}/hello`);

		expect(await response.text()).toBe("GET /hello 0");
	});

	it("carries a WebSocket both ways", async () => {
		const forward = forwarding(worker, app.port as number);
		const socket = new WebSocket(`ws://127.0.0.1:${forward.local}/hmr`);
		await new Promise((resolve) => socket.addEventListener("open", resolve));

		socket.send("hi");
		const heard = await new Promise<string>((resolve) =>
			socket.addEventListener("message", (event) =>
				resolve(String(event.data)),
			),
		);

		expect(heard).toBe("echo hi");
		socket.close();
	});

	it("carries a body bigger than the session holds unacked", async () => {
		const forward = forwarding(worker, app.port as number);
		const body = "x".repeat(1_000_000);

		const response = await fetch(`http://127.0.0.1:${forward.local}/big`, {
			method: "POST",
			body,
		});

		expect(await response.text()).toBe("POST /big 1000000");
	});

	it("hangs up a connection to a port nothing answers on", async () => {
		const closed = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = closed.port as number;
		await closed.stop(true);
		const forward = forwarding(worker, port);

		const failed = await fetch(`http://127.0.0.1:${forward.local}/`).then(
			() => false,
			() => true,
		);

		expect(failed).toBe(true);
	});

	it("keeps the worker's port number when it is free here", async () => {
		const free = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data: () => {} },
		});
		const prefer = free.port;
		free.stop(true);

		const forward = forwarding(worker, app.port as number, prefer);

		expect(forward.local).toBe(prefer);
	});
});

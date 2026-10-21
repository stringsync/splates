import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { printed } from "../agents/testing";
import { eventually } from "../conversations/testing";
import { CONNECTIONS, type Connection } from "../server/shared";
import { WorkerDaemon } from "./daemon";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { ServerWorkerSocket } from "./server-socket";
import { FaultProxy } from "./testing";
import { WebSocketWorkerSocket } from "./websocket-socket";

setDefaultTimeout(20_000);

// The link's pace, scaled down from heartbeat 10s and timeout 30s so a
// stall past the timeout takes a second.
const PACE = {
	heartbeat: Duration.ms(100),
	timeout: Duration.ms(400),
	ackDelay: Duration.ms(5),
};

/** Counts to `count` over about `count * 50`ms, one number a line. */
const COUNT = (count: number) =>
	`i=1; while [ $i -le ${count} ]; do echo $i; i=$((i+1)); sleep 0.05; done`;
const COUNTED = (count: number) =>
	Array.from({ length: count }, (_, i) => `${i + 1}\n`).join("");

describe("the worker link through a faulty network", () => {
	let dir: string;
	let registry: WorkerRegistry;
	let server: Bun.Server<Connection>;
	let proxy: FaultProxy;
	let daemon: WorkerDaemon;
	let worker: RemoteWorker;
	let joins: number;

	const serve = (port: number) =>
		Bun.serve<Connection>({
			port,
			hostname: "127.0.0.1",
			fetch: (request, bun) =>
				bun.upgrade(request, {
					data: new ServerWorkerSocket(registry, "box"),
				})
					? undefined
					: new Response("a WebSocket, please", { status: 400 }),
			websocket: CONNECTIONS,
		});

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-link-"));
		registry = new WorkerRegistry(new MemoryLogger(), { session: PACE });
		joins = 0;
		registry.events.on("joined", () => joins++);
		server = serve(0);
		proxy = FaultProxy.listen(server.port as number);
		const url = `ws://127.0.0.1:${proxy.port}/api/workers`;
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		daemon = new WorkerDaemon(
			{
				where: url,
				dial: () => WebSocketWorkerSocket.connect(url, {}, Duration.ms(300)),
			},
			{
				id: "box",
				slots: 4,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				session: PACE,
				orphanBound: Duration.secs(10),
			},
		);
		void daemon.run();
		worker = await joined;
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		proxy.dispose();
		registry.dispose();
		await server.stop(true);
		await rm(dir, { recursive: true, force: true });
	});

	it("carries an agent's output through the proxy untouched", async () => {
		const child = worker.start(["/bin/sh", "-c", COUNT(5)], dir);

		expect(await printed(child)).toBe(COUNTED(5));
	});

	it("delivers all of an agent's output despite latency", async () => {
		proxy.delay(30);
		const child = worker.start(["/bin/sh", "-c", COUNT(10)], dir);

		expect(await printed(child)).toBe(COUNTED(10));
	});

	it("keeps an agent's output across a dropped connection", async () => {
		const child = worker.start(["/bin/sh", "-c", COUNT(30)], dir);
		const received = printed(child);
		await sleep(Duration.ms(300));

		proxy.drop();

		expect(await received).toBe(COUNTED(30));
		expect(joins).toBeGreaterThan(1);
	});

	it("keeps an agent's output across a silence long past the link's timeout", async () => {
		const child = worker.start(["/bin/sh", "-c", COUNT(40)], dir);
		const received = printed(child);
		await sleep(Duration.ms(300));

		proxy.stall();
		await sleep(Duration.secs(1));
		proxy.resume();

		expect(await received).toBe(COUNTED(40));
		expect(joins).toBeGreaterThan(1);
	});

	it("keeps an agent's output when a frame is cut in half", async () => {
		const child = worker.start(["/bin/sh", "-c", COUNT(30)], dir);
		const received = printed(child);
		await sleep(Duration.ms(300));

		proxy.cutNextFrame("toCoordinator");

		expect(await received).toBe(COUNTED(30));
		expect(joins).toBeGreaterThan(1);
	});

	it("keeps an agent's output when the coordinator's frame is cut in half", async () => {
		const child = worker.start(["cat"], dir);
		const received = printed(child);
		await sleep(Duration.ms(100));
		proxy.cutNextFrame("toWorker");

		const input = child.input.getWriter();
		await input.write(new TextEncoder().encode("hello\n"));
		await sleep(Duration.ms(600));
		await input.write(new TextEncoder().encode("again\n"));
		await input.close();

		expect(await received).toBe("hello\nagain\n");
	});

	it("rejoins once a refused port opens again", async () => {
		proxy.refuse();
		proxy.drop();
		await eventually(() => !worker.connected, 10);
		await sleep(Duration.ms(300));
		const before = joins;

		proxy.reopen();

		await eventually(() => joins > before, 10);
		expect(worker.connected).toBe(true);
	});

	it("rejoins once a blackholed dial ends", async () => {
		proxy.blackhole();
		proxy.drop();
		await eventually(() => !worker.connected, 10);
		// Long enough that every dial in flight has been swallowed.
		await sleep(Duration.secs(1));
		const before = joins;

		proxy.reopen();

		await eventually(() => joins > before, 20);
		expect(worker.connected).toBe(true);
	});

	// scry-ignore simple-test-setup: it alone restarts the server, which is what it tests
	it("keeps its process through a server restart, and reattaches to it", async () => {
		const child = worker.start(["/bin/sh", "-c", COUNT(40)], dir);
		const received = printed(child);
		await sleep(Duration.ms(300));
		const pid = child.pid as number;
		const { id } = worker.session;

		await registry.detach();
		registry.dispose();
		await server.stop(true);
		await sleep(Duration.ms(300));
		expect(new NodePs().alive(pid)).toBe(true);
		registry = new WorkerRegistry(new MemoryLogger(), {
			session: { ...PACE, id },
		});
		server = serve(proxy.upstreamPort);
		const rejoined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);

		await rejoined;

		expect(new NodePs().alive(pid)).toBe(true);
		expect(daemon.session.writable).toBe(true);
		void received;
	});
});

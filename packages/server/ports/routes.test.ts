import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../dev-sockets";
import { ACCESS_HEADER } from "../tunnel";
import { FakeAccess } from "../tunnel/testing";
import type { RemoteWorker } from "../workers";
import {
	UnixWorkerListener,
	UnixWorkerSocket,
	WorkerDaemon,
	WorkerRegistry,
} from "../workers";
import { DevTaskPorts } from "./routes";

describe("DevTaskPorts", () => {
	let dir: string;
	let worktree: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let app: Bun.Subprocess<"ignore", "pipe", "inherit">;
	let appPort: number;
	let fake: FakeAccess;
	let ports: DevTaskPorts;
	let front: Bun.Server<Connection>;
	/** The worker, by id, alpha's worktree is on. */
	let on: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-task-ports-"));
		worktree = join(dir, "alpha");
		await mkdir(worktree);
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
				id: "local",
				slots: 8,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void daemon.run();
		(await joined).kind = "local";
		app = Bun.spawn(["bun", "-e", APP], { cwd: worktree, stdout: "pipe" });
		const reader = app.stdout.getReader();
		appPort = Number(new TextDecoder().decode((await reader.read()).value));
		reader.releaseLock();
		fake = await FakeAccess.make();
		on = "local";
		ports = new DevTaskPorts({
			workers: () => registry.workers,
			owners: async () => ({
				worktrees: [{ task: "alpha", path: worktree, worker: on }],
				agents: [],
			}),
			base: "ports.test",
			access: fake.access,
			log: new MemoryLogger(),
		});
		front = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request, server) =>
				ports.claim(request, server) ?? new Response("the page"),
			websocket: CONNECTIONS,
		});
	});

	afterEach(async () => {
		await front.stop(true);
		ports.dispose();
		app.kill();
		await app.exited;
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
	});

	const at = (
		path: string,
		headers: Record<string, string>,
		label = `alpha-${appPort}`,
	) =>
		fetch(`http://127.0.0.1:${front.port}${path}`, {
			headers: { host: `${label}.ports.test`, ...headers },
			redirect: "manual",
		});

	/** A WebSocket the page opens to the task's server, once it is open. */
	const socketAt = async (path: string, protocols: string[]) => {
		const options: Bun.WebSocketOptions = {
			headers: {
				host: `alpha-${appPort}.ports.test`,
				[ACCESS_HEADER]: await fake.token(),
			},
			protocols,
		};
		const socket = new WebSocket(
			`ws://127.0.0.1:${front.port}${path}`,
			options as string[],
		);
		await new Promise((resolve) => socket.addEventListener("open", resolve));
		return socket;
	};

	it("lists the port the task's server listens on, with both its links", async () => {
		expect(await ports.links()).toEqual([
			{
				task: "alpha",
				port: appPort,
				local: `http://127.0.0.1:${appPort}`,
				remote: `https://alpha-${appPort}.ports.test`,
			},
		]);
	});

	it("forwards a port a task serves on another worker to one here", async () => {
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		const path = join(dir, "worker.sock");
		const box = new WorkerDaemon(
			{ where: path, dial: () => UnixWorkerSocket.connect(path) },
			{
				id: "box",
				slots: 2,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
			},
		);
		void box.run();
		try {
			await joined;
			on = "box";

			const [link] = await ports.links();
			expect(link).toMatchObject({ task: "alpha", port: appPort });
			// The app holds its own number on this machine, so the forward takes another.
			expect(link?.local).not.toBe(`http://127.0.0.1:${appPort}`);
			const response = await fetch(`${link?.local}/app`);
			expect(await response.json()).toMatchObject({ path: "/app" });
		} finally {
			ports.dispose();
			await box.disposeAsync();
		}
	});

	it("proxies a request Access let through to the task's server, as its own localhost", async () => {
		const token = await fake.token();

		const response = await at("/app", {
			[ACCESS_HEADER]: token,
			cookie: `theme=dark; CF_Authorization=${token}`,
		});

		expect(await response.json()).toEqual({
			path: "/app",
			host: `localhost:${appPort}`,
			cookie: "theme=dark",
			"x-forwarded-host": `alpha-${appPort}.ports.test`,
			[ACCESS_HEADER]: null,
		});
	});

	it("refuses a request without an Access token", async () => {
		const response = await at("/app", {});

		expect(response.status).toBe(403);
	});

	it("sends a redirect to the task's own localhost back to its port host", async () => {
		const response = await at("/login", {
			[ACCESS_HEADER]: await fake.token(),
		});

		expect(response.headers.get("location")).toBe(
			`https://alpha-${appPort}.ports.test/home`,
		);
	});

	it("says no task serves a port nothing in a task listens on", async () => {
		const response = await at(
			"/",
			{ [ACCESS_HEADER]: await fake.token() },
			`alpha-${front.port}`,
		);

		expect(response.status).toBe(404);
	});

	it("leaves any other host to the page", async () => {
		const response = await fetch(`http://127.0.0.1:${front.port}/`);

		expect(await response.text()).toBe("the page");
	});

	it("carries a WebSocket to the task's server, with the subprotocol it chose", async () => {
		const socket = await socketAt("/hmr", ["vite-hmr"]);

		socket.send("hi");
		const heard = await new Promise<string>((resolve) =>
			socket.addEventListener("message", (event) =>
				resolve(String(event.data)),
			),
		);

		expect(heard).toBe("echo hi");
		expect(socket.protocol).toBe("vite-hmr");
		socket.close();
	});
});

/** A task's dev server: says what it was asked, redirects, and echoes a WebSocket. */
const APP = `
const server = Bun.serve({
	port: 0,
	hostname: "127.0.0.1",
	fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === "/hmr") {
			return server.upgrade(request, {
				headers: { "sec-websocket-protocol": "vite-hmr" },
			}) ? undefined : new Response("no", { status: 400 });
		}
		if (url.pathname === "/login") {
			return Response.redirect("http://localhost:" + server.port + "/home", 302);
		}
		const said = {};
		for (const name of ["host", "cookie", "x-forwarded-host", "${ACCESS_HEADER}"]) {
			said[name] = request.headers.get(name);
		}
		return Response.json({ path: url.pathname, ...said });
	},
	websocket: { message(socket, message) { socket.send("echo " + message); } },
});
console.log(server.port);
`;

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { printed } from "../agents/testing";
import { WorkerDaemon } from "./daemon";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { UnixWorkerListener } from "./unix-listener";
import { UnixWorkerSocket } from "./unix-socket";
import type { WakeTarget } from "./wake";

describe("WorkerDaemon", () => {
	let dir: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let worker: RemoteWorker;
	let holds: boolean[];
	let woke: WakeTarget[];

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-worker-"));
		holds = [];
		woke = [];
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
				orphanBound: Duration.secs(2),
				servers: { servers: async () => [BROWSER] },
				network: {
					broadcasts: ["192.168.1.255"],
					wake: { mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255" },
				},
				waker: {
					send: async (target) => {
						woke.push(target);
					},
				},
				awake: {
					hold: () => {
						const at = holds.push(true) - 1;
						return {
							dispose: () => {
								holds[at] = false;
							},
						};
					},
				},
			},
		);
		void daemon.run();
		worker = await joined;
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
	});

	it("joins with its slots, platform and build", () => {
		expect(worker.info).toMatchObject({
			slots: 8,
			platform: process.platform,
			build: expect.any(String),
			checkouts: true,
		});
		expect(worker.connected).toBe(true);
	});

	it("says where it can wake others, and what waking it takes", () => {
		expect(worker.info).toMatchObject({
			broadcasts: ["192.168.1.255"],
			wake: { mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255" },
		});
	});

	it("sends a magic packet when the coordinator asks", async () => {
		const target = { mac: "aa:bb:cc:dd:ee:02", broadcast: "192.168.1.255" };

		expect(worker.wakes).toBe(true);
		await worker.wake(target);

		expect(woke).toEqual([target]);
	});

	it("stops, ending what it runs, once the coordinator asks it to restart on its build", async () => {
		const child = worker.start(["sleep", "30"], dir);
		const stopped = new Promise((resolve) =>
			worker.session.events.on("lost", resolve, { once: true }),
		);

		expect(worker.session.update("9.9.9")).toBe(true);

		await stopped;
		expect(await child.exited).not.toBe(0);
	});

	it("runs a process and streams back its stdout, stderr and exit code", async () => {
		const child = worker.start(
			["/bin/sh", "-c", "echo out; echo err >&2; exit 3"],
			dir,
		);

		expect(await printed(child)).toBe("out\n");
		expect(await child.exited).toBe(3);
		expect(child.stderr()).toBe("err\n");
		expect(child.pid).toBeNumber();
	});

	it("pipes the coordinator's writes to the process's stdin", async () => {
		const child = worker.start(["cat"], dir);
		const input = child.input.getWriter();

		await input.write(new TextEncoder().encode("hello\n"));
		await input.close();

		expect(await printed(child)).toBe("hello\n");
		expect(await child.exited).toBe(0);
	});

	it("keeps the machine awake while a process runs", async () => {
		const child = worker.start(["sleep", "30"], dir);
		await sleep(Duration.ms(100));

		expect(holds).toEqual([true]);

		child.kill();
		await child.exited;
		await sleep(Duration.ms(100));

		expect(holds).toEqual([false]);
	});

	it("kills a process when asked", async () => {
		const child = worker.start(["sleep", "30"], dir);
		await sleep(Duration.ms(100));

		child.kill();

		expect(await child.exited).not.toBe(0);
	});

	it("says why a process could not start", async () => {
		const child = worker.start(["/no/such/program"], dir);

		expect(await child.exited).toBe(127);
		expect(child.stderr()).toContain("cannot start /no/such/program");
	});

	// scry-ignore simple-test-setup: its shell and what it types are its own; no other test opens a pty
	it("runs a shell on a pseudo-terminal and hears what it types back", async () => {
		const shell = worker.pty({
			argv: ["/bin/sh", "-c", 'read line; printf "got:%s" "$line"'],
			cwd: dir,
			cols: 80,
			rows: 24,
		});
		let seen = "";
		shell.events.on("data", (bytes) => {
			seen += new TextDecoder().decode(bytes);
		});
		const exited = new Promise<number>((resolve) =>
			shell.events.on("exit", resolve),
		);

		shell.write("hi\r");

		expect(await exited).toBe(0);
		expect(seen).toContain("got:hi");
	});

	it("answers git, the process table and file reads for the coordinator", async () => {
		await writeFile(join(dir, "output.log"), "hello world");

		expect((await worker.git(dir, ["--version"])).stdout).toStartWith(
			"git version",
		);
		expect(await worker.processes()).toContainEqual(
			expect.objectContaining({ pid: process.pid }),
		);
		expect(await worker.read(join(dir, "output.log"), 6)).toEqual({
			size: 11,
			bytes: new TextEncoder().encode("world"),
		});
		expect(await worker.read(join(dir, "missing.log"), 0)).toEqual({
			size: 0,
			bytes: new Uint8Array(0),
		});
	});

	it("offers the coordinator's sessions the MCP servers it runs, such as its browser", async () => {
		expect(await worker.servers()).toEqual([BROWSER]);
	});

	it("runs git with what the coordinator adds to its environment, such as a token", async () => {
		const ran = await worker.git(dir, ["config", "--get", "splates.said"], {
			GIT_CONFIG_COUNT: "1",
			GIT_CONFIG_KEY_0: "splates.said",
			GIT_CONFIG_VALUE_0: "hello",
		});

		expect(ran).toMatchObject({ code: 0, stdout: "hello\n" });
	});

	// scry-ignore simple-test-setup: it alone drops and brings back the coordinator, which is what it tests
	it("stalls a process while the coordinator is away past the bound, and loses nothing", async () => {
		const child = worker.start(
			["/bin/sh", "-c", "sleep 0.3; head -c 20000000 /dev/zero"],
			dir,
		);
		const received = printed(child);
		await sleep(Duration.ms(100));
		const pid = child.pid as number;

		await listener.disposeAsync();
		await sleep(Duration.secs(1));

		expect(daemon.session.writable).toBe(false);
		expect(new NodePs().alive(pid)).toBe(true);

		listener = await UnixWorkerListener.listen(listener.path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));

		expect((await received).length).toBe(20_000_000);
		expect(await child.exited).toBe(0);
	});

	// scry-ignore simple-test-setup: it alone drops the coordinator for good, which is what it tests
	it("ends a process when the coordinator does not return within the bound", async () => {
		const child = worker.start(["sleep", "30"], dir);
		await sleep(Duration.ms(100));
		const pid = child.pid as number;

		await listener.disposeAsync();
		await sleep(Duration.ms(1000));
		expect(new NodePs().alive(pid)).toBe(true);
		await sleep(Duration.ms(1500));

		await sleep(Duration.ms(100));
		expect(new NodePs().alive(pid)).toBe(false);
	});
});

const BROWSER = {
	type: "http" as const,
	name: "playwright",
	url: "http://localhost:4100/mcp",
	headers: [],
};

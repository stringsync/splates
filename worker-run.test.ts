import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { printed } from "./agent-process-testing";
import type { RemoteWorker } from "./remote-worker";
import { UnixWorkerListener } from "./unix-worker-listener";
import { WorkerRegistry } from "./worker-registry";

const CLI = join(import.meta.dirname, "index.ts");

describe("arbor worker run", () => {
	let dir: string;
	let path: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "arbor-worker-run-"));
		path = join(dir, "worker.sock");
		registry = new WorkerRegistry(new MemoryLogger());
		listener = await UnixWorkerListener.listen(path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));
	});

	afterEach(async () => {
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
	});

	// scry-ignore simple-test-setup: the one test, and its subprocess is what it tests
	it("joins its coordinator as a process of its own, runs what it is given, and stops on SIGTERM", async () => {
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		const daemon = Bun.spawn(
			[
				process.execPath,
				CLI,
				"worker",
				"run",
				"--coordinator",
				`unix:${path}`,
				"--id",
				"cli",
				"--slots",
				"2",
			],
			{
				env: { ...process.env, ARBOR_HOME: dir },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const worker = await joined;
		const child = worker.start(["echo", "from the daemon"], dir);

		expect(worker).toMatchObject({ id: "cli", info: { slots: 2 } });
		expect(await printed(child)).toBe("from the daemon\n");

		daemon.kill("SIGTERM");

		expect(await daemon.exited).toBe(0);
	});
});

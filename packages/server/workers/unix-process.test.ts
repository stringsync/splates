import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { printed } from "../agents/testing";
import { Testing } from "../testing";
import { WorkerDaemon } from "./daemon";
import { WorkerRegistry } from "./registry";
import { UnixWorkerListener } from "./unix-listener";
import { UnixWorkerSocket } from "./unix-socket";
import type { ConnectedWorker } from "./worker";

describe("processes over the Unix worker link", () => {
	let deps: Testing;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let worker: ConnectedWorker;
	let lost: string[];

	beforeEach(async () => {
		deps = await Testing.open();
		const pace = { heartbeat: Duration.ms(20), timeout: Duration.ms(200) };
		registry = new WorkerRegistry(new MemoryLogger(), { session: pace });
		const path = join(deps.splatesHome, "worker.sock");
		listener = await UnixWorkerListener.listen(path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));
		const joined = new Promise<ConnectedWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		daemon = new WorkerDaemon(
			{ where: path, dial: () => UnixWorkerSocket.connect(path) },
			{
				id: "local",
				slots: 1,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				session: pace,
			},
		);
		void daemon.run();
		worker = await joined;
		lost = [];
		worker.session.events.on("lost", ({ reason }) => lost.push(reason));
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await deps.disposeAsync();
	});

	it("keeps heartbeats flowing after a process exits and closes its channel", async () => {
		const child = worker.start(["/bin/echo", "done"], deps.root);
		expect(await printed(child)).toBe("done\n");
		expect(await child.exited).toBe(0);
		await sleep(Duration.ms(300));
		expect(lost).toEqual([]);
		expect(worker.connected).toBe(true);
		expect(daemon.session.connected).toBe(true);
	});

	it("keeps the link when a process output consumer cancels its stream", async () => {
		const child = worker.start(["/bin/cat"], deps.root);
		await child.output.cancel();
		await child.exited;
		await sleep(Duration.ms(300));
		expect(lost).toEqual([]);
		expect(worker.connected).toBe(true);
		expect(daemon.session.connected).toBe(true);
		const next = worker.start(["/bin/echo", "still connected"], deps.root);
		expect(await printed(next)).toBe("still connected\n");
	});
});

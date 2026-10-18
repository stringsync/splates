import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs } from "webappwiz/system";
import { Testing } from "../testing";
import { WorkerRegistry } from "./registry";
import { WorkerSession } from "./session";
import { UnixWorkerListener } from "./unix-listener";
import { UnixWorkerSocket } from "./unix-socket";

describe("UnixWorkerListener startup", () => {
	let deps: Testing;
	let fs: HeldPermissions;
	let listener: UnixWorkerListener | undefined;
	let early: UnixWorkerSocket | undefined;
	let registry: WorkerRegistry;
	let worker: WorkerSession;

	beforeEach(async () => {
		deps = await Testing.open();
		fs = new HeldPermissions();
		registry = new WorkerRegistry(new MemoryLogger());
		worker = new WorkerSession("worker");
	});

	afterEach(async () => {
		fs.release.resolve();
		early?.dispose();
		worker.dispose();
		registry.dispose();
		await listener?.disposeAsync();
		await deps.disposeAsync();
	});

	// scry-ignore simple-test-setup: starting the listener with permissions held is the race under test.
	it("turns away a worker arriving before permissions finish so it can reconnect to the ready listener", async () => {
		const path = join(deps.splatesHome, "worker.sock");
		const listening = UnixWorkerListener.listen(path, fs);
		await fs.entered.promise;
		early = await UnixWorkerSocket.connect(path);
		const closed = new Promise<void>((resolve) =>
			early?.events.on("close", resolve, { once: true }),
		);
		fs.release.resolve();
		listener = await listening;
		listener.events.on("socket", (socket) => void registry.accept(socket));
		await closed;

		const socket = await UnixWorkerSocket.connect(path);
		const negotiated = await worker.connect(socket, { id: "local" });
		expect(negotiated.ok).toBe(true);
		expect(registry.worker("local")?.connected).toBe(true);
	});
});

/** Keeps startup in its asynchronous permissions step while a worker dials. */
class HeldPermissions extends NodeFs {
	readonly entered = Promise.withResolvers<void>();
	readonly release = Promise.withResolvers<void>();

	override async chmod(path: string, mode: number): Promise<void> {
		this.entered.resolve();
		await this.release.promise;
		await super.chmod(path, mode);
	}
}

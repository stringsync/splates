import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySecretStore } from "webappwiz/creds";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import type { Launch } from "../agents";
import { printed } from "../agents/testing";
import { WorkerDaemon } from "./daemon";
import { KeyDelivery } from "./key-delivery";
import { WorkerKeys } from "./keys";
import { WorkerRecords } from "./records";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { UnixWorkerListener } from "./unix-listener";
import { UnixWorkerSocket } from "./unix-socket";

const KEY = "sk-ant-the-real-key";

describe("KeyDelivery", () => {
	let dir: string;
	let registry: WorkerRegistry;
	let listener: UnixWorkerListener;
	let daemon: WorkerDaemon;
	let worker: RemoteWorker;
	let held: MemorySecretStore;
	let keys: WorkerKeys;
	let delivery: KeyDelivery;
	let logs: MemoryLogger[];
	/** How Claude starts on the worker, which has been sent its keys. */
	let claude: Launch;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "splates-keys-"));
		const path = join(dir, "worker.sock");
		logs = [new MemoryLogger(), new MemoryLogger()];
		registry = new WorkerRegistry(logs[0] as MemoryLogger);
		listener = await UnixWorkerListener.listen(path, new NodeFs());
		listener.events.on("socket", (socket) => void registry.accept(socket));
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		held = new MemorySecretStore("the worker's keys");
		daemon = new WorkerDaemon(
			{ where: path, dial: () => UnixWorkerSocket.connect(path) },
			{
				id: "box",
				slots: 2,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: logs[1] as MemoryLogger,
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				keys: held,
			},
		);
		void daemon.run();
		worker = await joined;
		keys = WorkerKeys.memory(new FakeSecretStore());
		await keys.add({ worker: "box" }, "anthropic", KEY);
		delivery = new KeyDelivery({
			keys,
			registry,
			records: WorkerRecords.memory(),
			log: logs[0] as MemoryLogger,
		});
		claude = await delivery.launch(worker, "claude");
	});

	afterEach(async () => {
		await daemon.disposeAsync();
		registry.dispose();
		await listener.disposeAsync();
		await rm(dir, { recursive: true, force: true });
	});

	it("starts an agent on a placeholder and a loopback proxy, never the key", async () => {
		const child = claude(
			[
				"/bin/sh",
				"-c",
				'printf "%s\\n%s\\n" "$ANTHROPIC_API_KEY" "$ANTHROPIC_BASE_URL"; env',
			],
			dir,
			{},
		);

		const out = await printed(child);
		const [placeholder, base] = out.split("\n");
		expect(out).not.toContain(KEY);
		expect(placeholder).toBeTruthy();
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(await held.get("SPLATES_ANTHROPIC_KEY_WORKER_BOX")).toBe(KEY);
		expect(JSON.stringify(logs.map((log) => log.entries))).not.toContain(KEY);
	});

	it("refuses a request to the proxy without its placeholder, and stops it once the agent ends", async () => {
		const child = claude(
			["/bin/sh", "-c", 'echo "$ANTHROPIC_BASE_URL"; read line'],
			dir,
			{},
		);
		const output = child.output.getReader();
		const first = await output.read();
		const base = new TextDecoder().decode(first.value?.bytes).trim();

		const refused = await fetch(`${base}/v1/messages`, {
			method: "POST",
			headers: { "x-api-key": "guessed" },
		});
		expect(refused.status).toBe(401);
		expect(await refused.text()).not.toContain(KEY);

		child.kill();
		await child.exited;
		await expect(fetch(`${base}/v1/messages`)).rejects.toThrow();
	});

	it("starts an agent that needs no key as it would anywhere", async () => {
		const launch = await delivery.launch(worker, "opencode");
		const child = launch(
			["/bin/sh", "-c", 'echo "[$ANTHROPIC_BASE_URL]"'],
			dir,
			// Emptied, so a base URL set on the machine running the test is not read as the proxy's.
			{ ANTHROPIC_BASE_URL: "" },
		);

		expect(await printed(child)).toBe("[]\n");
	});

	it("takes a key away from the worker as soon as the roster drops it", async () => {
		await keys.remove({ worker: "box" }, "anthropic");
		await delivery.resend();

		expect(await held.names()).toEqual([]);
	});

	it("has a worker being removed drop every key, and forgets its own", async () => {
		await delivery.forget("box");

		expect(await held.names()).toEqual([]);
		expect(keys.all).toEqual([]);
	});

	it("drops every key once the worker stops", async () => {
		await daemon.disposeAsync();

		expect(await held.names()).toEqual([]);
	});
});

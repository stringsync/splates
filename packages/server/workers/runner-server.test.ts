import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { Testing } from "../testing";
import { JobSnapshot } from "./job-snapshot";
import { WorkerRegistry } from "./registry";
import type { RemoteWorker } from "./remote";
import { RunnerServer } from "./runner-server";
import { WebSocketWorkerSocket } from "./websocket-socket";

const SECRET = "runner-test-bearer";

describe("the reachable runner", () => {
	let deps: Testing;
	let server: RunnerServer;
	let registry: WorkerRegistry;
	let url: string;

	beforeEach(async () => {
		deps = await Testing.open();
		server = new RunnerServer(new NodePs(), {
			secret: SECRET,
			home: join(deps.root, "runner"),
			port: 0,
			hostname: "127.0.0.1",
		});
		registry = new WorkerRegistry(new MemoryLogger());
		url = `http://127.0.0.1:${server.port}/api/jobs`;
	});

	afterEach(async () => {
		registry.dispose();
		await server.disposeAsync();
		await deps[Symbol.asyncDispose]();
	});

	it("requires a bearer secret before upgrading or answering any path", async () => {
		expect((await fetch(url)).status).toBe(401);
		expect(
			(await fetch(url, { headers: { authorization: "Bearer wrong" } })).status,
		).toBe(401);
		expect(
			(await fetch(url, { headers: { authorization: `Bearer ${SECRET}` } }))
				.status,
		).toBe(426);
	});

	// scry-ignore simple-test-setup: only this case opens an authenticated job connection; the other tests exercise HTTP refusals
	it("runs the existing job channel through a WebSocket with output and returned files", async () => {
		const socket = await WebSocketWorkerSocket.connect(
			url.replace("http:", "ws:"),
			{ authorization: `Bearer ${SECRET}` },
		);
		const joined = new Promise<RemoteWorker>((resolve) =>
			registry.events.on("joined", resolve, { once: true }),
		);
		const accepted = registry.accept(socket);
		socket.send("ready");
		await accepted;
		const worker = await joined;
		expect(worker.info).toMatchObject({ jobs: true, slots: 0 });
		const snapshot = new JobSnapshot(deps.git);
		const commit = await snapshot.take(deps.root);
		const output: Uint8Array[] = [];
		const result = await worker.job(
			{
				project: deps.root,
				commit,
				task: null,
				prepare: null,
				argv: [
					"sh",
					"-c",
					'printf runner-ok; printf file-ok > "$SPLATES_JOB_FILES/result"',
				],
				env: {},
				files: ["result"],
				timeoutMs: 5000,
			},
			{
				bundle: (tip) => snapshot.bundle(deps.root, commit, tip),
				output: (bytes) => output.push(bytes),
			},
		);
		expect(result.code).toBe(0);
		expect(Buffer.concat(output).toString()).toBe("runner-ok");
		expect(Buffer.from(result.files.get("result") ?? []).toString()).toBe(
			"file-ok",
		);
	}, 15000);
});

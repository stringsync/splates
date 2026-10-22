import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../server/shared";
import {
	Snapshots,
	WebSocketWorkerSocket,
	WorkerBudget,
	WorkerDaemon,
	WorkerRecords,
} from "./index";
import { DevWorkers, workerAuthorization } from "./routes";
import { FakeWorkerProvider } from "./testing";
import type { WakeTarget } from "./wake";

const PC = { mac: "aa:bb:cc:dd:ee:01", broadcast: "192.168.1.255" };

describe("DevWorkers waking a worker at home", () => {
	let provider: FakeWorkerProvider;
	let records: WorkerRecords;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;
	let daemons: WorkerDaemon[];

	beforeEach(async () => {
		provider = new FakeWorkerProvider();
		records = WorkerRecords.memory();
		daemons = [];
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				workers.open(request, server) ??
				new Response("not found", { status: 404 }),
		});
		workers = await coordinator();
	});

	afterEach(async () => {
		for (const daemon of daemons) {
			await daemon.disposeAsync();
		}
		await workers.disposeAsync();
		server.stop(true);
	});

	/** A server over `records`, its own machine's worker taking nothing, so every agent queues. */
	async function coordinator(): Promise<DevWorkers> {
		const made = new DevWorkers(new MemoryLogger(), {
			records,
			provider: {
				provider,
				snapshots: await Snapshots.open(provider, {
					version: "1.0.0",
					document: null,
				}),
				coordinator: () => `http://127.0.0.1:${server.port}`,
				budget: WorkerBudget.memory(),
			},
		});
		await made.update(put("local", { draining: true }));
		return made;
	}

	/**
	 * Joins worker `id` and runs it until it says hello, on `broadcasts`,
	 * saying it may sleep when given `wake`, and sending each packet it is
	 * asked to into `sent`.
	 */
	async function joined(
		id: string,
		opts: JoinedOptions,
	): Promise<WorkerDaemon> {
		const { token } = await records.invite();
		const answer = await workers.join(
			new Request("http://127.0.0.1/api/workers/join", {
				method: "POST",
				body: JSON.stringify({ token, id }),
			}),
		);
		const { key } = (await answer.json()) as { key: string };
		const url = `ws://127.0.0.1:${server.port}/api/workers`;
		const headers = { authorization: workerAuthorization(id, key) };
		const daemon = new WorkerDaemon(
			{ where: url, dial: () => WebSocketWorkerSocket.connect(url, headers) },
			{
				id,
				slots: 4,
				ps: new NodePs(),
				fs: new NodeFs(),
				log: new MemoryLogger(),
				backoff: { min: Duration.ms(20), max: Duration.ms(100) },
				network: { broadcasts: opts.broadcasts, wake: opts.wake ?? null },
				waker: {
					send: async (target) => {
						opts.sent?.push(target);
					},
				},
			},
		);
		daemons.push(daemon);
		const hello = new Promise((resolve) =>
			workers.registry.events.on(
				"joined",
				(worker) => worker.id === id && resolve(worker),
			),
		);
		void daemon.run();
		await hello;
		return daemon;
	}

	it("has an awake worker on its network wake a sleeping PC before making one, and places the agent there once it joins", async () => {
		const sent: WakeTarget[] = [];
		await joined("mac", { broadcasts: ["192.168.1.255"], sent });
		const pc = await joined("pc", { broadcasts: [PC.broadcast], wake: PC });
		await workers.update(put("mac", { draining: true }));
		await pc.disposeAsync();
		await Bun.sleep(20);
		expect(await health("pc")).toBe("asleep");

		const placed = workers.slots.scheduler.take(request("one"));
		await Bun.sleep(20);

		expect(sent).toEqual([PC]);
		expect(await health("pc")).toBe("waking");
		expect(provider.specs).toEqual([]);
		await joined("pc", { broadcasts: [PC.broadcast], wake: PC });
		expect((await placed).worker).toBe("pc");
		expect(records.of("pc")?.wokenAt).toEqual(expect.any(Number));
	});

	it("wakes a PC that slept through a restart, from what its record keeps", async () => {
		const sent: WakeTarget[] = [];
		const pc = await joined("pc", { broadcasts: [PC.broadcast], wake: PC });
		await pc.disposeAsync();
		await workers.disposeAsync();
		workers = await coordinator();
		await joined("mac", { broadcasts: ["192.168.1.255"], sent });
		await workers.update(put("mac", { draining: true }));

		void workers.slots.scheduler.take(request("one")).catch(() => {});
		await Bun.sleep(20);

		expect(sent).toEqual([PC]);
	});

	it("makes a worker at once when none awake is on the PC's network to wake it", async () => {
		const sent: WakeTarget[] = [];
		await joined("office", { broadcasts: ["10.0.0.255"], sent });
		await workers.update(put("office", { draining: true }));
		const pc = await joined("pc", { broadcasts: [PC.broadcast], wake: PC });
		await pc.disposeAsync();
		await Bun.sleep(20);

		void workers.slots.scheduler.take(request("one")).catch(() => {});
		await Bun.sleep(50);

		expect(sent).toEqual([]);
		expect(provider.specs).toHaveLength(1);
	});

	it("wakes a sleeping PC when the person asks", async () => {
		const sent: WakeTarget[] = [];
		await joined("mac", { broadcasts: ["192.168.1.255"], sent });
		const pc = await joined("pc", { broadcasts: [PC.broadcast], wake: PC });
		await pc.disposeAsync();
		await Bun.sleep(20);

		const answer = await workers.manage(
			new Request("http://127.0.0.1/api/workers/pc/wake", { method: "POST" }),
			(handle) => handle,
		);

		expect(answer.status).toBe(200);
		expect(sent).toEqual([PC]);
		expect(await health("pc")).toBe("waking");
	});

	/** How `GET /api/workers` lists worker `id`'s health. */
	async function health(id: string): Promise<string | undefined> {
		const { workers: listed } = (await (await workers.list()).json()) as {
			workers: { id: string; health: string }[];
		};
		return listed.find((each) => each.id === id)?.health;
	}
});

/** How `joined` runs a worker: the networks it says, and where its packets go. */
interface JoinedOptions {
	broadcasts: string[];
	wake?: WakeTarget;
	sent?: WakeTarget[];
}

function request(id: string) {
	return {
		id,
		task: `${id}-task`,
		agent: "claude",
		project: "/repo",
		platform: null,
	};
}

function put(id: string, body: unknown): Request {
	return new Request(`http://127.0.0.1/api/workers/${id}`, {
		method: "PUT",
		body: JSON.stringify(body),
	});
}

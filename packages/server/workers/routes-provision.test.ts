// scry-ignore-file simple-test-setup: its imports moved to server/; it predates the rule
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodeFs, NodePs } from "webappwiz/system";
import { Duration } from "webappwiz/time";
import { CONNECTIONS, type Connection } from "../server/shared";
import { FakeWorkerProvider } from "../workers/testing";
import {
	Snapshots,
	WebSocketWorkerSocket,
	WorkerBudget,
	WorkerDaemon,
} from "./index";
import { DevWorkers, workerAuthorization } from "./routes";

describe("DevWorkers with a worker provider", () => {
	let provider: FakeWorkerProvider;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;

	beforeEach(async () => {
		provider = new FakeWorkerProvider();
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				workers.open(request, server) ??
				new Response("not found", { status: 404 }),
		});
		workers = new DevWorkers(new MemoryLogger(), {
			provider: {
				provider,
				snapshots: await Snapshots.open(provider, {
					version: "1.0.0",
					path: null,
				}),
				coordinator: () => `http://127.0.0.1:${server.port}`,
				// A rate cap the one small worker fills.
				budget: await budgetOf({ hour: 0.05 }),
			},
		});
		// This machine's worker takes nothing, so every agent queues.
		await workers.update(put("local", { draining: true }));
	});

	afterEach(async () => {
		await workers.disposeAsync();
		server.stop(true);
	});

	it("makes a worker for an agent that queues, which joins and runs it", async () => {
		const placed = workers.slots.scheduler.take(request("one"));
		await Bun.sleep(10);
		const [spec] = provider.specs;
		const id = spec?.id ?? "";
		const daemon = await booted(server, workers, spec?.boot ?? []);
		void daemon.run();

		expect((await placed).worker).toBe(id);
		expect(provider.getCalls()).toEqual([
			"snapshot linux 1.0.0",
			`create ${id} small snap-1`,
		]);
		expect(workers.registry.worker(id)?.kind).toBe("provisioned");
		await daemon.disposeAsync();
	});

	it("makes no more than the rate cap allows, and the queue says so", async () => {
		void workers.slots.scheduler.take(request("one")).catch(() => {});
		await Bun.sleep(10);
		void workers.slots.scheduler.take(request("two")).catch(() => {});
		void workers.slots.scheduler.take(request("three")).catch(() => {});
		void workers.slots.scheduler.take(request("four")).catch(() => {});
		void workers.slots.scheduler.take(request("five")).catch(() => {});
		await Bun.sleep(10);

		expect(provider.specs).toHaveLength(1);
		expect(workers.slots.scheduler.spot("five")?.reason).toBe(
			"rate cap $0.05/h reached",
		);
	});

	it("stops made workers once the day's limit is reached, destroying each once idle", async () => {
		const made = await (await workers.provision(post({}))).json();
		await workers.provisioning?.budget.set("day", 0);
		const stopping: string[][] = [];
		workers.provisioning?.events.on("stopping", ({ held }) => {
			stopping.push(held.map((each) => each.id));
		});

		await workers.provisioning?.look(workers.slots.scheduler);

		expect(provider.getCalls()).toContain(`destroy ${made.id}`);
		expect(workers.registry.worker(made.id)).toBeUndefined();
		expect(workers.provisioning?.budget.rate()).toBe(0);
		expect(stopping).toEqual([]);
	});

	it("holds the agents a stop checkpoints, and carries them on once the budget allows", async () => {
		const placed = workers.slots.scheduler.take(request("one"));
		await Bun.sleep(10);
		const daemon = await booted(server, workers, provider.specs[0]?.boot ?? []);
		void daemon.run();
		await placed;
		const budget = workers.provisioning?.budget;
		const stopping: string[][] = [];
		workers.provisioning?.events.on("stopping", ({ held }) => {
			stopping.push(held.map((each) => each.id));
		});
		const carrying: string[][] = [];
		workers.provisioning?.events.on("carrying", ({ held }) => {
			carrying.push(held.map((each) => each.conversation));
		});

		await budget?.set("day", 0);
		await workers.provisioning?.look(workers.slots.scheduler);
		await workers.provisioning?.look(workers.slots.scheduler);
		expect(stopping).toEqual([["one"]]);
		expect(budget?.held).toEqual([{ project: "/repo", conversation: "one" }]);
		expect(carrying).toEqual([]);

		await budget?.set("day", null);
		await workers.provisioning?.refill();
		expect(carrying).toEqual([["one"]]);
		expect(budget?.held).toEqual([]);
		await daemon.disposeAsync();
	});

	it("destroys a made worker's machine when it is removed", async () => {
		const made = await (await workers.provision(post({}))).json();
		await workers.remove(del(made.id));

		expect(provider.getCalls()).toContain(`destroy ${made.id}`);
		expect(workers.registry.worker(made.id)).toBeUndefined();
		expect(await provider.list()).toEqual([]);
	});

	it("refuses a type the provider does not make", async () => {
		const answer = await workers.provision(post({ type: "huge" }));

		expect(answer.status).toBe(502);
		expect((await answer.json()).message).toContain("makes no huge");
	});

	it("refuses to provision without a provider", async () => {
		const bare = new DevWorkers(new MemoryLogger());
		const answer = await bare.provision(post({}));

		expect(answer.status).toBe(400);
		await bare.disposeAsync();
	});
});

/**
 * Boots the worker `boot` describes as its machine would: spends its join
 * token, then dials with the key that answers.
 */
async function booted(
	server: Bun.Server<Connection>,
	workers: DevWorkers,
	boot: string[],
): Promise<WorkerDaemon> {
	const flag = (name: string) => boot[boot.indexOf(name) + 1] ?? "";
	const id = flag("--id");
	const joined = await workers.join(
		new Request("http://127.0.0.1/api/workers/join", {
			method: "POST",
			body: JSON.stringify({ token: flag("--join"), id }),
		}),
	);
	const { key } = (await joined.json()) as { key: string };
	const url = `ws://127.0.0.1:${server.port}/api/workers`;
	const headers = { authorization: workerAuthorization(id, key) };
	return new WorkerDaemon(
		{ where: url, dial: () => WebSocketWorkerSocket.connect(url, headers) },
		{
			id,
			slots: Number(flag("--slots")),
			ps: new NodePs(),
			fs: new NodeFs(),
			log: new MemoryLogger(),
			backoff: { min: Duration.ms(20), max: Duration.ms(100) },
		},
	);
}

/** A budget in memory with `limits` set over the defaults. */
async function budgetOf(
	limits: Partial<Record<"hour" | "day" | "month", number>>,
): Promise<WorkerBudget> {
	const budget = WorkerBudget.memory();
	for (const [limit, dollars] of Object.entries(limits)) {
		await budget.set(limit as "hour" | "day" | "month", dollars);
	}
	return budget;
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

function post(body: unknown): Request {
	return new Request("http://127.0.0.1/api/workers/provision", {
		method: "POST",
		body: JSON.stringify(body),
	});
}

function del(id: string): Request {
	return new Request(`http://127.0.0.1/api/workers/${id}?force`, {
		method: "DELETE",
	});
}

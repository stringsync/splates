// scry-ignore-file simple-test-setup: its imports moved to server/; it predates the rule
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { Duration } from "webappwiz/time";
import { FakeWallClock } from "webappwiz/time/testing";
import { CONNECTIONS, type Connection } from "../server/shared";
import { FakeWorkerProvider } from "../workers/testing";
import { Snapshots, WorkerBudget, WorkerRecords } from "./index";
import { DevWorkers } from "./routes";

describe("DevWorkers with a worker provider", () => {
	let provider: FakeWorkerProvider;
	let workers: DevWorkers;
	let server: Bun.Server<Connection>;
	let wall: FakeWallClock;

	beforeEach(async () => {
		provider = new FakeWorkerProvider();
		wall = new FakeWallClock();
		server = Bun.serve<Connection>({
			port: 0,
			hostname: "127.0.0.1",
			websocket: CONNECTIONS,
			fetch: (request, server) =>
				workers.open(request, server) ??
				new Response("not found", { status: 404 }),
		});
		workers = new DevWorkers(new MemoryLogger(), {
			records: WorkerRecords.memory(wall),
			provider: {
				wall,
				provider,
				snapshots: await Snapshots.open(provider, {
					version: "1.0.0",
					document: null,
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

	it("destroys a made worker that has not joined once its join token runs out", async () => {
		const { id } = await (await workers.provision(post({}))).json();

		wall.advance(Duration.mins(14));
		await workers.provisioning?.look(workers.slots.scheduler);
		expect(provider.getCalls()).not.toContain(`destroy ${id}`);
		wall.advance(Duration.mins(1));
		await workers.provisioning?.look(workers.slots.scheduler);

		expect(provider.getCalls()).toContain(`destroy ${id}`);
		expect(workers.registry.worker(id)).toBeUndefined();
		expect(workers.records.of(id)).toBeUndefined();
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

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { NodePs } from "webappwiz/system";
import { listQueue, moveQueued } from "./queue";
import { DevWorkers } from "./routes";

describe("splates queue", () => {
	let workers: DevWorkers;
	let server: Bun.Server<undefined>;
	let url: string;
	const signal = new AbortController().signal;

	beforeEach(async () => {
		workers = new DevWorkers(new MemoryLogger(), { platform: "darwin" });
		workers.local.info = { slots: 1, platform: "darwin" };
		server = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: (request) =>
				request.method === "PUT"
					? workers.moveQueued(request)
					: workers.queue(),
		});
		url = `http://127.0.0.1:${server.port}`;
		const app = workers.slots.project("/code/app", null);
		await app.take({ id: "c1", task: "login", agent: "claude" }, signal);
		void app.take({ id: "c2", task: "signup", agent: "claude" }, signal);
		void app.take({ id: "c3", task: null, agent: "claude" }, signal);
		void workers.slots
			.project("/code/site", "linux")
			.take({ id: "c4", task: "deploy", agent: "claude" }, signal);
	});

	afterEach(async () => {
		await workers.disposeAsync();
		server.stop(true);
	});

	async function run(
		go: (log: MemoryLogger) => Promise<void>,
	): Promise<string> {
		const log = new MemoryLogger();
		await go(log);
		return log.entries.map((entry) => String(entry.message)).join("\n");
	}

	it("lists who waits for a slot, first in line first, and why", async () => {
		const out = await run((log) =>
			listQueue({ dev: url, json: false, log, ps: new NodePs() }),
		);
		const rows = out.split("\n").slice(1);
		expect(rows.map((row) => row.split(/\s+/).slice(0, 4))).toEqual([
			["1", "app", "signup", "c2"],
			["2", "app", "-", "c3"],
			["3", "site", "deploy", "c4"],
		]);
		expect(rows[2]).toContain("needs Linux");
		expect(rows[0]).toContain("no free slot");
	});

	it("moves an agent by its task or its conversation", async () => {
		const out = await run((log) =>
			moveQueued({
				which: "deploy",
				position: 1,
				dev: url,
				json: true,
				log,
				ps: new NodePs(),
			}),
		);
		expect(
			(JSON.parse(out) as { id: string }[]).map((entry) => entry.id),
		).toEqual(["c4", "c2", "c3"]);
		await moveQueued({
			which: "c3",
			position: 1,
			dev: url,
			json: true,
			log: new MemoryLogger(),
			ps: new NodePs(),
		});
		expect(workers.slots.scheduler.queue().map((entry) => entry.id)).toEqual([
			"c3",
			"c4",
			"c2",
		]);
	});

	it("refuses to move what does not wait", async () => {
		await expect(
			moveQueued({
				which: "login",
				position: 1,
				dev: url,
				json: false,
				log: new MemoryLogger(),
				ps: new NodePs(),
			}),
		).rejects.toThrow("nothing waits in the queue for login");
	});
});

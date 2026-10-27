import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { RUNNING } from "../server/shared";
import { DevWorkers } from "./routes";

describe("DevWorkers", () => {
	let workers: DevWorkers;

	beforeEach(() => {
		workers = new DevWorkers(new MemoryLogger());
	});
	afterEach(async () => {
		await workers.disposeAsync();
	});
	it.each([
		["join", "POST"],
		["invite", "POST"],
		["box", "PUT"],
		["box", "DELETE"],
	])("refuses the retired worker route %s %s", async (path, method) => {
		const response = await workers.manage(
			new Request(`http://localhost/api/workers/${path}`, { method }),
			(handle) => handle,
		);
		expect(response.status).toBe(404);
	});

	it("knows a kept handoff worker again after a restart, pooling it only once it joins", async () => {
		await workers.records.set("local-2.0.0", { draining: false });
		const again = new DevWorkers(new MemoryLogger(), {
			records: workers.records,
		});
		expect(again.registry.worker("local-2.0.0")).toBeDefined();
		expect(
			again.placement.pool.workers().find((each) => each.id === "local-2.0.0"),
		).toMatchObject({ awake: false });
		await again.disposeAsync();
	});

	it("pools no handoff worker its records do not keep", () => {
		workers.registry.expect("local-9.9.9", "local");
		expect(
			workers.placement.pool.workers().map((each) => each.id),
		).not.toContain("local-9.9.9");
	});

	it("places nothing new on a drained worker", async () => {
		await workers.update(put("local", { draining: true }));
		const placed = workers.placement.scheduler.take(request("one"));
		let settled = false;
		void placed.then(() => {
			settled = true;
		});
		await Bun.sleep(10);

		expect(settled).toBe(false);
		expect(workers.placement.scheduler.queue()).toHaveLength(1);
		await workers.update(put("local", { draining: false }));
		expect((await placed).worker).toBe("local");
	});

	it("pauses what splates starts on its own, the person's own agents still placed, and places it on resume", async () => {
		let changes = 0;
		workers.placement.scheduler.events.on("changed", () => {
			changes += 1;
		});
		expect((await workers.update(put("local", { paused: true }))).status).toBe(
			200,
		);
		expect(changes).toBe(1);
		const automatic = workers.placement.scheduler.take(request("theirs"));
		await workers.placement.scheduler.take({
			...request("mine"),
			automatic: false,
		});
		await Bun.sleep(10);
		expect(workers.placement.scheduler.spot("theirs")?.reason).toBe("paused");

		const listed = await (await workers.list()).json();
		expect(listed).toMatchObject({
			paused: true,
			held: [
				{
					id: "mine",
					project: "/repo",
					task: "mine-task",
					automatic: false,
					since: expect.any(String),
				},
			],
		});

		changes = 0;
		await workers.update(put("local", { paused: false }));
		expect((await automatic).worker).toBe("local");
		expect(changes).toBeGreaterThan(0);
		expect((await (await workers.list()).json()).held).toMatchObject([
			{ id: "mine", automatic: false },
			{ id: "theirs", automatic: true },
		]);
	});

	it("refuses to pause any worker but this machine's own", async () => {
		const response = await workers.update(put("box", { paused: true }));

		expect(response.status).toBe(400);
		expect(workers.records.paused).toBe(false);
	});

	it("lists the build it runs beside the workers, as each set by hand", async () => {
		await workers.update(put("local", { draining: true }));
		const listed = await (await workers.list()).json();

		expect(listed).toMatchObject({
			build: RUNNING,
			workers: [{ id: "local", draining: true }],
		});
	});

	it("removes this machine's own worker from the pool for good, keeping its process", async () => {
		const removed = await (await workers.remove(del("local"))).json();
		expect(removed).toMatchObject({ removed: true, running: [] });

		const listed = await (await workers.list()).json();
		expect(listed.workers).toEqual([]);
		expect(workers.registry.worker("local")).toBe(workers.local);
		const placed = workers.placement.scheduler.take({
			...request("mine"),
			automatic: false,
		});
		await Bun.sleep(10);
		expect(workers.placement.scheduler.spot("mine")?.reason).toBe(
			"no worker up",
		);

		const again = new DevWorkers(new MemoryLogger(), {
			records: workers.records,
		});
		expect((await (await again.list()).json()).workers).toEqual([]);
		await again.disposeAsync();

		await workers.update(put("local", { draining: false }));
		expect((await placed).worker).toBe("local");
		expect((await (await workers.list()).json()).workers).toMatchObject([
			{ id: "local", draining: false, removing: false },
		]);
	});

	it("lets this machine's own agents run to their end as its worker is removed", async () => {
		const held = workers.placement.scheduler.hold(
			{ ...request("mine"), automatic: false },
			"local",
		);
		const waiting = await (await workers.remove(del("local"))).json();
		expect(waiting).toMatchObject({ removed: false, running: ["mine-task"] });
		expect((await workers.remove(del("local", true))).status).toBe(400);

		held.dispose();
		await Bun.sleep(10);
		expect(workers.records.localOn).toBe(false);
		expect(workers.records.of("local")).toMatchObject({
			draining: false,
			removing: false,
		});
		expect((await workers.remove(del("local"))).status).toBe(404);
	});

	it("brings this machine's own worker back only to take agents again", async () => {
		await workers.remove(del("local"));
		expect(
			(await workers.update(put("local", { draining: true }))).status,
		).toBe(404);
		expect(workers.records.localOn).toBe(false);
		expect(
			(await workers.update(put("local", { draining: false }))).status,
		).toBe(200);
		expect(workers.records.localOn).toBe(true);
	});
});

function put(id: string, body: unknown): Request {
	return new Request(`http://127.0.0.1/api/workers/${id}`, {
		method: "PUT",
		body: JSON.stringify(body),
	});
}

function del(id: string, force = false): Request {
	return new Request(
		`http://127.0.0.1/api/workers/${id}${force ? "?force" : ""}`,
		{ method: "DELETE" },
	);
}

function request(id: string) {
	return {
		id,
		task: `${id}-task`,
		project: "/repo",
		agent: "claude",
		automatic: true,
	};
}

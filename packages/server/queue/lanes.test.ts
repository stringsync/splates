import { describe, expect, it } from "bun:test";
import { laneAdd, laneQueue, taskAdd } from "../board";
import { Testing } from "../testing";
import { stalled } from "./order";

/** Each task's stage, by id. */
async function stages(deps: Testing): Promise<Record<number, string>> {
	return Object.fromEntries(
		(await deps.tasks.all()).map((task) => [task.id, task.state.stage]),
	);
}

describe.concurrent("queueing a lane", () => {
	it("queues every task waiting in it at once, blocked or not, and none put in it later", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await taskAdd(deps, "check them", null, { lane: 1, blockedBy: [1] });
		await taskAdd(deps, "elsewhere", null);

		const queued = await laneQueue(deps, 1, true);
		expect(queued.map((task) => task.id)).toEqual([1, 2]);
		expect(await stages(deps)).toEqual({
			1: "queued",
			2: "queued",
			3: "backlog",
		});
		expect((await deps.tasks.find(2)).state.queuedBy).toEqual({
			by: "lane",
			lane: 1,
		});

		await taskAdd(deps, "added later", null, { lane: 1 });
		expect((await deps.tasks.find(4)).state.stage).toBe("backlog");
		// Queued again, only what waits now joins.
		expect((await laneQueue(deps, 1, true)).map((task) => task.id)).toEqual([
			4,
		]);
	});

	it("journals what it queued as a queue add", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });

		await laneQueue(deps, 1, true);
		expect((await deps.journal.tail(1))[0]).toMatchObject({
			action: "queue add",
			tasks: [{ id: 1, subject: "store licenses" }],
		});
	});

	it("takes its queued tasks back out, leaving the rest", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1, ready: true });
		await taskAdd(deps, "check them", null, { lane: 1 });
		await laneQueue(deps, 1, true);

		const out = await laneQueue(deps, 1, false);
		expect(out.map((task) => task.id)).toEqual([1, 2]);
		expect(await stages(deps)).toEqual({ 1: "ready", 2: "backlog" });
	});

	it("leaves the queue to let go of a task blocked by one that will not start from it", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await laneAdd(deps, "Billing");
		await taskAdd(deps, "invoices", null, { lane: 2 });
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await taskAdd(deps, "check them", null, { lane: 1, blockedBy: [2] });
		await taskAdd(deps, "bill for them", null, { lane: 1, blockedBy: [1] });
		await laneQueue(deps, 1, true);

		const all = (await deps.tasks.all()).map((task) => task.state);
		// #3 waits on #2, queued with it; #4 on #1, in a lane not queued.
		expect([...stalled(all)]).toEqual([[4, [1]]]);
	});

	it("reads a lane once queued whole as a plain lane", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await deps.tasks.store.records.write(
			"lanes",
			JSON.stringify([
				{ id: 0, name: "Backlog" },
				{ id: 1, name: "Licensing", queued: true, skip: [3], budget: 4 },
			]),
		);

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
		]);
	});
});

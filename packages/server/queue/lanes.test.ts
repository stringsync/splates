import { describe, expect, it } from "bun:test";
import {
	APPROVAL,
	laneAdd,
	laneUpdate,
	taskAdd,
	taskRemove,
	taskUpdate,
} from "../board";
import { add, remove } from "../tasks";
import { Testing } from "../testing";
import { queueAdd, queueRemove } from "./commands";

/** Each task's stage, by id. */
async function stages(deps: Testing): Promise<Record<number, string>> {
	return Object.fromEntries(
		(await deps.tasks.all()).map((task) => [task.id, task.state.stage]),
	);
}

describe.concurrent("a lane queued whole", () => {
	it("queues only what nothing blocks, then each task as its blocker goes", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await taskAdd(deps, "check them", null, { lane: 1, blockedBy: [1] });
		await taskAdd(deps, "elsewhere", null);

		await laneUpdate(deps, 1, { queued: true });
		expect(await deps.tasks.queueFromLanes()).toMatchObject([{ id: 1 }]);
		expect(await stages(deps)).toEqual({
			1: "queued",
			2: "backlog",
			3: "backlog",
		});
		// Nothing new to queue: none is queued twice.
		expect(await deps.tasks.queueFromLanes()).toEqual([]);

		// Removal clears the link so the lane can queue its follower.
		await taskRemove(deps, 1);
		expect(await deps.tasks.queueFromLanes()).toMatchObject([{ id: 2 }]);
		await taskAdd(deps, "added later", null, { lane: 1 });
		const queued = await deps.tasks.queueFromLanes();
		expect(queued.map((task) => task.id)).toEqual([4]);
	});

	it("keeps its budget when a failed checkout leaves a running record untaken", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Quiet events");
		await taskAdd(deps, "first", null, { lane: 1, ready: true });
		await taskAdd(deps, "follower", null, { lane: 1, blockedBy: [1] });
		await laneUpdate(deps, 1, { queued: true });
		await deps.tasks.queueFromLanes();
		const budget = (await deps.tasks.lanes())[1]?.budget;
		deps.config.postCheckout = "exit 3";

		await expect(add(deps, "first", { tasks: [1] })).toBail("hook_failed");
		expect((await deps.tasks.find(1)).state).toMatchObject({
			stage: "running",
			takenBy: null,
		});
		const sweeps = [
			await deps.tasks.queueFromLanes(),
			await deps.tasks.queueFromLanes(),
			await deps.tasks.queueFromLanes(),
		];
		expect(sweeps).toEqual([[], [], []]);
		expect((await deps.tasks.lanes())[1]?.budget).toBe(budget);
		expect((await deps.tasks.find(2)).state.stage).toBe("backlog");
	});

	it("leaves out a task taken out of the queue by hand, until it is queued again", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });
		await deps.tasks.queueFromLanes();

		await queueRemove(deps, [1]);
		expect(await deps.tasks.queueFromLanes()).toEqual([]);
		expect((await deps.tasks.find(1)).state.stage).toBe("backlog");

		await queueAdd(deps, [1]);
		await queueRemove(deps, [1]);
		await queueAdd(deps, [1]);
		expect((await deps.tasks.lanes())[1]).toEqual({
			id: 1,
			name: "Licensing",
			queued: true,
			budget: 20,
		});
	});

	it("passes over a task only the person queues, which starts once they queue it", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await taskAdd(deps, "check them", null, { lane: 1 });
		await taskUpdate(deps, 1, { manual: true });

		await laneUpdate(deps, 1, { queued: true });
		expect(await deps.tasks.queueFromLanes()).toMatchObject([{ id: 2 }]);
		expect((await deps.tasks.find(1)).state).toMatchObject({
			stage: "backlog",
			manual: true,
		});

		await queueAdd(deps, [1]);
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");
		await queueRemove(deps, [1]);
		await taskUpdate(deps, 1, { manual: false });
		await queueAdd(deps, [1]);
		await queueRemove(deps, [1]);
		await queueAdd(deps, [1]);
		expect((await deps.tasks.find(1)).state.manual).toBeUndefined();
	});

	it("never queues again a task whose start was deferred, until the person queues it", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });
		await deps.tasks.queueFromLanes();
		await add(deps, "store-licenses", { tasks: [1] });

		// Deferred work stays open without starting again from its queued lane.
		await remove(deps, "store-licenses", {
			reason: "blocked",
			deferral: { why: "It needs a key.", outside: ["a key"] },
		});

		expect(await deps.tasks.queueFromLanes()).toEqual([]);
		expect((await deps.tasks.find(1)).state).toMatchObject({
			stage: "backlog",
			takenBy: null,
		});
		await queueAdd(deps, [1]);
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");
	});

	it("unqueues what it holds once stopped, taken or not", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await taskAdd(deps, "under way", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });
		await deps.tasks.queueFromLanes();
		await (await deps.tasks.find(2)).take("alpha");

		await laneUpdate(deps, 1, { queued: false });

		expect((await deps.tasks.find(1)).state.stage).toBe("backlog");
		expect((await deps.tasks.find(2)).state).toMatchObject({
			stage: "backlog",
			takenBy: "alpha",
		});
		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
		]);
		expect(await deps.tasks.queueFromLanes()).toEqual([]);
	});

	it("once stopped, sends a task started from it back to the backlog when its start ends", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "store licenses", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });
		await deps.tasks.queueFromLanes();
		await add(deps, "alpha", { tasks: [1] });

		await laneUpdate(deps, 1, { queued: false });
		await remove(deps, "alpha", {
			reason: "blocked",
			deferral: { why: "It needs a key.", outside: ["a key"] },
		});

		expect((await deps.tasks.find(1)).state.stage).toBe("backlog");
		expect(await deps.tasks.queueFromLanes()).toEqual([]);
	});

	it("is queued no more once the lane is empty", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "only step", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });

		await taskRemove(deps, 1);
		await deps.tasks.queueFromLanes();

		expect(await deps.tasks.lanes()).toEqual([
			{ id: 0, name: "Backlog" },
			{ id: 1, name: "Licensing" },
		]);
	});

	it("queues no more than its budget until the person approves more", async () => {
		await using deps = await Testing.open();
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "first", null, { lane: 1 });
		await laneUpdate(deps, 1, { queued: true });
		// One task in it, plus the slack agents' follow-ups spend.
		const budget = (await deps.tasks.lanes())[1]?.budget ?? 0;
		expect(budget).toBeGreaterThan(1);

		await Promise.all(
			Array.from({ length: budget }, (_, i) =>
				taskAdd(deps, `follow-up ${i}`, null, { lane: 1 }),
			),
		);
		expect((await deps.tasks.queueFromLanes()).map((task) => task.id)).toEqual(
			Array.from({ length: budget }, (_, i) => i + 1),
		);
		expect((await deps.tasks.lanes())[1]?.budget).toBe(0);
		expect(await deps.tasks.queueFromLanes()).toEqual([]);

		await laneUpdate(deps, 1, { approve: APPROVAL });
		expect((await deps.tasks.queueFromLanes()).map((task) => task.id)).toEqual([
			budget + 1,
		]);
		expect((await deps.tasks.lanes())[1]?.budget).toBe(APPROVAL - 1);
	});
});

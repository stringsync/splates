import { describe, expect, it } from "bun:test";
import { laneAdd, laneUpdate, taskAdd, taskRemove, taskUpdate } from "../board";
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

		// Removed, not merged, its follower waits for the person to let it go.
		await taskRemove(deps, 1);
		expect(await deps.tasks.queueFromLanes()).toEqual([]);
		await taskUpdate(deps, 2, { removeBlockedBy: [1] });
		await taskAdd(deps, "added later", null, { lane: 1 });
		const queued = await deps.tasks.queueFromLanes();
		expect(queued.map((task) => task.id)).toEqual([2, 4]);
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
		expect((await deps.tasks.lanes())[0]).toEqual({
			id: 1,
			name: "Licensing",
			queued: true,
		});
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
			{ id: 1, name: "Licensing" },
			{ id: 0, name: "Backlog" },
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
		await remove(deps, "alpha", { reason: "redo" });

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
			{ id: 1, name: "Licensing" },
			{ id: 0, name: "Backlog" },
		]);
	});
});

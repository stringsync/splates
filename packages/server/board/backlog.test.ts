import { describe, expect, it } from "bun:test";
import { add } from "../tasks";
import { Testing } from "../testing";
import { BACKLOG_LANE, ungroomed } from "./backlog";
import { taskRemove } from "./task-edit";

describe("the permanent Backlog lane", () => {
	it("exists on an empty board and refuses rename, remove and merge-away without losing tasks", async () => {
		await using deps = await Testing.open();
		expect(await deps.tasks.lanes()).toEqual([
			{ id: BACKLOG_LANE, name: "Backlog", board: 1 },
		]);
		const task = await deps.tasks.add("deferred", null, { lane: BACKLOG_LANE });
		const _other = await deps.tasks.addLane("Editor");
		await expect(deps.tasks.renameLane(BACKLOG_LANE, "Gone")).toBail("usage");
		await expect(deps.tasks.dropLane(BACKLOG_LANE)).toBail("usage");
		expect((await deps.tasks.find(task.id)).lane).toBe(BACKLOG_LANE);
	});

	it("holds a new task as ungroomed until it is placed or the groomer claims it", async () => {
		await using deps = await Testing.open();
		const task = await deps.tasks.add("rough", null);
		expect(task.lane).toBe(BACKLOG_LANE);
		expect(ungroomed(task.state)).toBe(true);
		expect(await task.groom("groomer")).toBe(true);
		expect(ungroomed((await deps.tasks.find(task.id)).state)).toBe(false);
		const named = await deps.tasks.add("named", null, { lane: BACKLOG_LANE });
		expect(ungroomed(named.state)).toBe(true);
		expect(
			ungroomed({ lane: BACKLOG_LANE, takenBy: null, grooming: "placed" }),
		).toBe(true);
		const lane = await deps.tasks.addLane("Editor");
		await deps.tasks.arrange(task.id, lane.id);
		expect((await deps.tasks.find(task.id)).lane).toBe(lane.id);
	});

	it("can be queued and worked, and survives its last task finishing", async () => {
		await using deps = await Testing.open();
		await deps.tasks.add("deferred", null, { lane: BACKLOG_LANE });
		const { changed } = await deps.tasks.queueLane(BACKLOG_LANE, true);
		expect(changed.map((task) => task.id)).toEqual([1]);
		await add(deps, "deferred", { tasks: [1] });
		await taskRemove(deps, 1);
		expect(await deps.tasks.lanes()).toEqual([
			{ id: BACKLOG_LANE, name: "Backlog", board: 1 },
		]);
		expect(deps.out()).not.toContain("so it is gone");
	});
});

import { describe, expect, it } from "bun:test";
import { add } from "../tasks";
import { Testing } from "../testing";
import { BACKLOG_LANE } from "./backlog";
import { taskRemove } from "./task-edit";

describe("the permanent Backlog lane", () => {
	it("exists on an empty board and refuses rename, remove and merge-away without losing tasks", async () => {
		await using deps = await Testing.open();
		expect(await deps.tasks.lanes()).toEqual([
			{ id: BACKLOG_LANE, name: "Backlog" },
		]);
		const task = await deps.tasks.add("deferred", null, { lane: BACKLOG_LANE });
		const other = await deps.tasks.addLane("Editor");
		await expect(deps.tasks.renameLane(BACKLOG_LANE, "Gone")).toBail("usage");
		await expect(deps.tasks.dropLane(BACKLOG_LANE)).toBail("usage");
		await expect(deps.tasks.joinLanes(BACKLOG_LANE, other.id)).toBail("usage");
		expect((await deps.tasks.find(task.id)).lane).toBe(BACKLOG_LANE);
	});

	it("settles dependencies when unmatched tasks enter Backlog, and preserves a later move", async () => {
		await using deps = await Testing.open();
		const first = await deps.tasks.add("follower", null);
		const second = await deps.tasks.add("blocker", null);
		await deps.tasks.link(first.id, { add: [second.id] });
		await first.backlog();
		await second.backlog();
		expect((await deps.tasks.all()).map((task) => task.id)).toEqual([
			second.id,
			first.id,
		]);
		const lane = await deps.tasks.addLane("Editor");
		await deps.tasks.arrange(first.id, lane.id);
		await first.backlog();
		expect((await deps.tasks.find(first.id)).lane).toBe(lane.id);
	});

	it("can be queued and worked, and survives its last task finishing", async () => {
		await using deps = await Testing.open();
		await deps.tasks.add("deferred", null, { lane: BACKLOG_LANE });
		await deps.tasks.queueLane(BACKLOG_LANE, true);
		expect((await deps.tasks.queueFromLanes()).map((task) => task.id)).toEqual([
			1,
		]);
		await add(deps, "deferred", { tasks: [1] });
		await taskRemove(deps, 1);
		await deps.tasks.queueFromLanes();
		expect(await deps.tasks.lanes()).toEqual([
			{ id: BACKLOG_LANE, name: "Backlog" },
		]);
		expect(deps.out()).not.toContain("so it is gone");
	});

	it("keeps a lane queued when the tasks cannot be listed, rather than ending it as empty", async () => {
		await using deps = await Testing.open();
		const lane = await deps.tasks.addLane("Editor");
		await deps.tasks.add("work", null, { lane: lane.id });
		await deps.tasks.queueLane(lane.id, true);
		const list = deps.tasks.store.records.list.bind(deps.tasks.store.records);
		deps.tasks.store.records.list = () => Promise.reject(new Error("busy"));
		await expect(deps.tasks.queueFromLanes()).rejects.toThrow("busy");
		deps.tasks.store.records.list = list;
		expect(
			(await deps.tasks.lanes()).find((each) => each.id === lane.id),
		).toMatchObject({ queued: true });
	});
});

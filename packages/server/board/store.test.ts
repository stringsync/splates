import { describe, expect, it } from "bun:test";
import { add, remove } from "../tasks";
import { Testing } from "../testing";
import { taskAdd, taskRemove, taskUpdate } from "./task-edit";
import { decodeTask } from "./task-file";

/** Task `id` as its record holds it. */
async function stored(deps: Testing, id: number): Promise<unknown> {
	return decodeTask(
		(await deps.storage.collection("tasks").read(`${id}.md`)) ?? "",
	);
}

describe.concurrent("TaskStore", () => {
	it("starts a task under the queued task it takes up", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await taskAdd(deps, "dark charts too", null);

		await add(deps, "dark", { tasks: [1] });

		expect((await deps.service.find("dark")).state?.id).toBe(1);
		expect(await stored(deps, 1)).toMatchObject({
			id: 1,
			subject: "support dark mode",
			takenBy: "dark",
			task: "dark",
			stage: "running",
			startedFrom: "backlog",
			status: "working",
		});
		expect(await stored(deps, 2)).toMatchObject({ takenBy: null });
		expect((await deps.tasks.all()).map((task) => task.id)).toEqual([1, 2]);
	});

	it("numbers a task that takes up no queued task off the list, and forgets it as it goes", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "write docs", null);

		await add(deps, "alpha");

		expect(await stored(deps, 2)).toMatchObject({
			task: "alpha",
			listed: false,
		});
		expect((await deps.tasks.all()).map((task) => task.id)).toEqual([1]);
		expect((await taskAdd(deps, "next", null)).id).toBe(3);

		await remove(deps, "alpha");

		expect(await stored(deps, 2)).toBeNull();
		expect((await deps.service.find("alpha")).status).toBe("removed");
	});

	it("queues a deferred task's queued task again, as it was", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null, { lane: "new" });
		await add(deps, "dark", { tasks: [1] });

		await remove(deps, "dark", { reason: "blocked" });

		const record = await stored(deps, 1);
		expect(record).toMatchObject({
			id: 1,
			subject: "support dark mode",
			lane: 1,
			takenBy: null,
			stage: "backlog",
		});
		expect(record).not.toHaveProperty("task");
		expect(record).not.toHaveProperty("status");
		expect(record).not.toHaveProperty("lease");
	});

	it("keeps a task going when the queued task it started under is removed", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await add(deps, "dark", { tasks: [1] });

		await taskRemove(deps, 1);

		await expect(deps.tasks.find(1)).toBail("not_found");
		expect((await deps.service.find("dark")).status).toBe("working");
		expect(await stored(deps, 1)).toMatchObject({ listed: false });
	});

	it("keeps what each side wrote when the other writes the same record", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "support dark mode", null);
		await add(deps, "dark", { tasks: [1] });

		await taskUpdate(deps, 1, { subject: "dark mode everywhere" });
		await (await deps.service.find("dark")).save({ mergeAttempts: 2 });

		expect(await stored(deps, 1)).toMatchObject({
			subject: "dark mode everywhere",
			task: "dark",
			mergeAttempts: 2,
			status: "working",
		});
		expect((await deps.tasks.find(1)).state).not.toHaveProperty("task");
	});
});

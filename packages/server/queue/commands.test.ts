import { describe, expect, it } from "bun:test";
import { taskAdd, taskUpdate } from "../board";
import { Testing } from "../testing";
import { queueAdd, queueList, queueMove, queueRemove } from "./commands";

describe("queue commands", () => {
	it("queues tasks from the backlog or groomed, and takes them out to where they were", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Ungroomed", null);
		await taskAdd(deps, "Groomed", null, { assignee: { agent: "claude" } });

		await queueAdd(deps, [1, 2]);
		expect((await deps.tasks.all()).map((task) => task.state.stage)).toEqual([
			"queued",
			"queued",
		]);
		// Naming a model, as grooming does, leaves a queued task queued.
		await taskUpdate(deps, 1, { assignee: { agent: "claude" } });
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");

		await queueRemove(deps, [2]);
		expect((await deps.tasks.find(2)).state.stage).toBe("ready");
		await expect(queueRemove(deps, [2])).toBail("not_found");
	});

	it("refuses to queue a task already under way", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Taken", null);
		await (await deps.tasks.find(1)).take("alpha");

		await expect(queueAdd(deps, [1])).toBail("exists");
	});

	it("lists the queue in the order workers take it, with what each waits on", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Breakdowns", null);
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Not queued", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await taskUpdate(deps, 2, { blockedBy: [3] });
		await queueAdd(deps, [1, 2]);
		deps.log.clear();

		await queueList(deps, { json: true });
		expect(JSON.parse(deps.out()).map(({ id }: { id: number }) => id)).toEqual([
			2, 1,
		]);

		deps.log.clear();
		await queueList(deps);
		expect(deps.out()).toContain("#3 (backlog)");
	});

	it("moves a task in the queue, as far as its links allow", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "One", null);
		await taskAdd(deps, "Two", null);
		await taskAdd(deps, "Three", null);
		await queueAdd(deps, [1, 2, 3]);

		await queueMove(deps, 3, 1);
		deps.log.clear();
		await queueList(deps, { json: true });

		expect(JSON.parse(deps.out()).map(({ id }: { id: number }) => id)).toEqual([
			3, 1, 2,
		]);
	});
});

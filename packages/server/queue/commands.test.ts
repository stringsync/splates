import { describe, expect, it } from "bun:test";
import { taskAdd, taskUpdate } from "../board";
import { Testing } from "../testing";
import {
	queueAdd,
	queueList,
	queueMove,
	queueRemove,
	refuseAgentQueue,
} from "./commands";

/** Starts this command's caller as conversation `id`, the person having said each of `said`. */
async function caller(
	deps: Testing,
	id: string,
	said: { text: string; told?: string }[],
): Promise<void> {
	const log = deps.service.conversationLog(id);
	await log.append({
		kind: "start",
		id,
		agent: "fake",
		task: null,
		createdAt: "2026-10-20T00:00:00.000Z",
	});
	for (const prompt of said) {
		await log.append({ kind: "prompt", ...prompt });
	}
	deps.proc.env.SPLATES_CONVERSATION = id;
}

describe("queue commands", () => {
	it("queues tasks from the backlog or groomed, and takes them out to where they were", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Ungroomed", null);
		await taskAdd(deps, "Groomed", null, { ready: true });

		await queueAdd(deps, [1, 2]);
		expect((await deps.tasks.all()).map((task) => task.state.stage)).toEqual([
			"queued",
			"queued",
		]);
		// Naming a model is no grooming, and leaves a queued task queued.
		await taskUpdate(deps, 1, { assignee: { agent: "claude" } });
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");

		await queueRemove(deps, [1, 2]);
		expect((await deps.tasks.all()).map((task) => task.state.stage)).toEqual([
			"backlog",
			"ready",
		]);
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

	it("moves a task down the queue to the place asked", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "One", null);
		await taskAdd(deps, "Two", null);
		await taskAdd(deps, "Three", null);
		await taskAdd(deps, "Four", null);
		await queueAdd(deps, [1, 2, 3, 4]);
		const order = async () => {
			deps.log.clear();
			await queueList(deps, { json: true });
			return JSON.parse(deps.out()).map(({ id }: { id: number }) => id);
		};

		await queueMove(deps, 1, 2);
		expect(await order()).toEqual([2, 1, 3, 4]);
		await queueMove(deps, 2, 4);
		expect(await order()).toEqual([1, 3, 4, 2]);
		await queueMove(deps, 1, 9);
		expect(await order()).toEqual([3, 4, 2, 1]);
	});
	it("lets the person queue, and refuses an agent", async () => {
		await using deps = await Testing.open();
		await refuseAgentQueue(deps.service, "queue add");

		await caller(deps, "c1", [{ text: "Add a widget" }]);
		await expect(refuseAgentQueue(deps.service, "queue add")).toBail("usage", {
			message: "does not queue work",
		});
	});

	it("lets `queue add` alone through for an agent the person sent [SPLATES QUEUE]", async () => {
		await using deps = await Testing.open();
		await caller(deps, "c1", [
			{ text: "Add a widget" },
			{ text: "[SPLATES QUEUE]" },
		]);
		await refuseAgentQueue(deps.service, "queue add");
		await expect(refuseAgentQueue(deps.service, "queue move")).toBail("usage");
	});

	it("refuses an agent whose [SPLATES QUEUE] another agent told it", async () => {
		await using deps = await Testing.open();
		await caller(deps, "c1", [
			{ text: "[SPLATES QUEUE] Add a widget", told: "c2" },
		]);
		await expect(refuseAgentQueue(deps.service, "queue add")).toBail("usage");
	});
});

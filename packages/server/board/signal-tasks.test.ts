import { describe, expect, it } from "bun:test";
import { canStart, queueOrder } from "../queue/order";
import type { SignalRaise } from "../signals";
import { Testing } from "../testing";
import { closesOnFrom, SignalTasks } from "./signal-tasks";
import { taskAdd, taskUpdate } from "./task-edit";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const raise = (at: string, payload: unknown = null): SignalRaise => ({
	at,
	by: "test",
	payload,
});

function tasksOn(deps: Testing, raises: Record<string, SignalRaise[]>) {
	const subscribed: string[] = [];
	const tasks = new SignalTasks({
		tasks: deps.tasks,
		raises: async () => raises,
		subscribed: async (name) => {
			subscribed.push(name);
		},
		log: { error: (message) => expect(message).toBe("") },
	});
	return { tasks, subscribed };
}

describe.concurrent("SignalTasks", () => {
	it("keeps an open task open and subscribes to its signal once", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "wait for approval", null, {
			closesOn: closesOnFrom("wise.approved", "", NOW),
		});
		const { tasks, subscribed } = tasksOn(deps, {});

		await tasks.sweep();
		await tasks.sweep();

		expect(await tasks.on("wise.approved")).toBe(1);
		expect(subscribed).toEqual(["wise.approved"]);
		expect((await deps.tasks.all()).map((each) => each.id)).toEqual([1]);
	});

	it("never starts it, queued or not", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "wait", null, {
			closesOn: closesOnFrom("wise.approved", "", NOW),
		});
		const states = await deps.tasks.stored();
		const queued = states.map((each) => ({
			...each,
			stage: "queued" as const,
		}));

		expect(queueOrder(queued)).toEqual([]);
		expect(canStart(queued[0] as (typeof queued)[number], queued)).toBe(false);
	});

	it("ends as merged on a firing after it was attached, clearing what it blocks", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "wait for approval", null, {
			closesOn: closesOnFrom("wise.approved", "", NOW),
		});
		await taskAdd(deps, "ship it", null, { blockedBy: [1] });
		const before = raise("2026-11-21T11:00:00.000Z", "old");
		const after = raise("2026-11-21T13:00:00.000Z", { by: "sam" });
		const { tasks } = tasksOn(deps, { "wise.approved": [before] });

		await tasks.sweep();
		expect((await deps.tasks.find(2)).blockedBy).toEqual([1]);

		const fired = tasksOn(deps, { "wise.approved": [before, after] });
		await fired.tasks.sweep();

		expect((await deps.tasks.all()).map((each) => each.id)).toEqual([2]);
		expect((await deps.tasks.find(2)).state).toMatchObject({
			blockedBy: [],
			blockersLanded: [
				{
					id: 1,
					fired: {
						signal: "wise.approved",
						at: after.at,
						payload: { by: "sam" },
					},
				},
			],
		});
	});

	it("takes a firing from before it was attached with --since", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "wait", null, {
			closesOn: closesOnFrom("wise.approved", "2h", NOW),
		});
		const { tasks } = tasksOn(deps, {
			"wise.approved": [raise("2026-11-21T11:00:00.000Z")],
		});

		await tasks.sweep();

		expect(await deps.tasks.all()).toEqual([]);
	});

	it("can be attached to a task already on the board, and cleared", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "wait", null);

		await taskUpdate(deps, 1, {
			closesOn: closesOnFrom("wise.approved", "", NOW),
		});
		expect((await deps.tasks.find(1)).state.closesOn?.signal).toBe(
			"wise.approved",
		);

		await taskUpdate(deps, 1, { closesOn: null });
		expect((await deps.tasks.find(1)).state.closesOn).toBeUndefined();
	});
});

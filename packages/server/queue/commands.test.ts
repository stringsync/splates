import { describe, expect, it } from "bun:test";
import { laneQueue, taskAdd, taskUpdate } from "../board";
import { Testing } from "../testing";
import {
	queueAdd,
	queueList,
	queueMove,
	queueRemove,
	refuseAgentQueue,
} from "./commands";

describe("queue commands", () => {
	it("queues tasks, and takes them out to available again", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Ungroomed", null);
		await taskAdd(deps, "Groomed", null);

		await queueAdd(deps, [1, 2]);
		expect((await deps.tasks.all()).map((task) => task.state.stage)).toEqual([
			"queued",
			"queued",
		]);
		// Naming a model is no grooming, and leaves a queued task queued.
		expect((await deps.tasks.find(1)).state.queuedBy).toEqual({ by: "person" });
		expect((await deps.tasks.find(1)).state.queuedAt).toBeString();
		await taskUpdate(deps, 1, { assignee: { agent: "claude" } });
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");

		await queueRemove(deps, [1, 2]);
		expect((await deps.tasks.all()).map((task) => task.state.stage)).toEqual([
			"available",
			"available",
		]);
		expect((await deps.tasks.find(1)).state.queuedBy).toBeUndefined();
		expect((await deps.tasks.find(1)).state.queuedAt).toBeUndefined();
		await expect(queueRemove(deps, [2])).toBail("not_found");
	});

	it("names the chain of blockers not queued, with the command that queues it", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Charts", null);
		await taskAdd(deps, "Breakdowns", null);
		await taskAdd(deps, "Totals first", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await taskUpdate(deps, 2, { blockedBy: [3] });
		deps.log.clear();

		await queueAdd(deps, [1]);

		expect(deps.out()).toContain("#3 Totals first (available)");
		expect(deps.out()).toContain("#2 Breakdowns (available)");
		expect(deps.out()).toContain("`splates queue add 3 2`");

		deps.log.clear();
		await queueAdd(deps, [3, 2]);
		expect(deps.out()).not.toContain("not queued");
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
		expect(deps.out()).toContain("#3 (available)");
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
	it("lets the person change the queue, and refuses an agent", async () => {
		await using deps = await Testing.open();
		expect(await refuseAgentQueue(deps.service, "queue add")).toEqual({
			by: "person",
		});

		deps.proc.env.SPLATES_CONVERSATION = "c1";
		await expect(refuseAgentQueue(deps.service, "lane queue")).toBail("usage");
		delete deps.proc.env.SPLATES_CONVERSATION;
		deps.proc.env.SPLATES_STARTED_BY = "c2";
		await expect(refuseAgentQueue(deps.service, "queue remove")).toBail(
			"usage",
		);
	});

	it("asks the server for agent queue add and records agent provenance on the task", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Follow-up", null);
		deps.proc.env.SPLATES_CONVERSATION = "c-root";
		deps.proc.env.SPLATES_DEV = "http://localhost:4310";

		await expect(
			refuseAgentQueue(deps.service, "queue add", {
				ids: [1],
				log: deps.log,
				send: async () =>
					Response.json({
						allowed: false,
						reason: "never",
						level: "never",
						queued: 0,
						cap: 5,
					}),
			}),
		).toBail("usage");

		await expect(
			refuseAgentQueue(deps.service, "queue add", {
				ids: [1],
				log: deps.log,
				send: async () =>
					Response.json({
						allowed: false,
						reason: "cap",
						level: "safe",
						queued: 5,
						cap: 5,
					}),
			}),
		).toBail("usage");

		const agentBy = {
			by: "agent" as const,
			conversation: "c-root",
			task: "root-slug",
			fromTask: 10,
			root: {
				conversation: "c-root",
				task: "root-slug",
				boardTask: 10,
			},
		};
		const by = await refuseAgentQueue(deps.service, "queue add", {
			ids: [1],
			log: deps.log,
			send: async () =>
				Response.json({
					allowed: true,
					by: agentBy,
					level: "safe",
					queued: 1,
					cap: 5,
				}),
		});
		expect(by).toEqual(agentBy);

		await queueAdd(deps, [1], { by });
		expect((await deps.tasks.find(1)).state.queuedBy).toEqual(agentBy);
	});

	it("lets an agent queue a lane's waiting tasks only, as itself, once the server allows them", async () => {
		await using deps = await Testing.open();
		const lane = await deps.tasks.addLane("Export");
		await deps.tasks.add("Writer", null, { lane: lane.id });
		await deps.tasks.add("Endpoint", null, { lane: lane.id });
		deps.proc.env.SPLATES_CONVERSATION = "c-root";
		deps.proc.env.SPLATES_DEV = "http://localhost:4310";
		const agentBy = {
			by: "agent" as const,
			conversation: "c-root",
			task: null,
			root: { conversation: "c-root", task: null },
		};
		let asked: unknown;
		const by = await refuseAgentQueue(deps.service, "lane queue", {
			ids: [1, 2],
			log: deps.log,
			send: async (_url, init) => {
				asked = JSON.parse(String(init?.body));
				return Response.json({
					allowed: true,
					by: agentBy,
					level: "safe",
					queued: 2,
					cap: 5,
				});
			},
		});
		expect(asked).toEqual({ conversation: "c-root", ids: [1, 2] });

		// A task added after the server allowed the lane is not queued with it.
		await deps.tasks.add("Button", null, { lane: lane.id });
		const queued = await laneQueue(deps, lane.id, true, { by, only: [1, 2] });
		expect(queued.map((task) => task.id)).toEqual([1, 2]);
		expect((await deps.tasks.find(1)).state.queuedBy).toEqual(agentBy);
		expect((await deps.tasks.find(3)).state.stage).toBe("available");
	});
});

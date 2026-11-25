import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "core/log";
import { taskAdd } from "../board";
import { queueAdd } from "../queue";
import { Testing } from "../testing";
import type { TaskEvent, TaskEventName } from "./events";
import { type Fired, fireTaskEvent } from "./runner";
import { RunStore } from "./runs";
import type { Automation } from "./store";

describe("fireTaskEvent", () => {
	let deps: Testing;
	let automations: Automation[];
	let runs: RunStore;
	let ran: string[];

	const fireOn = (name: TaskEventName, ...numbers: number[]) =>
		fireTaskEvent(eventOf(name, numbers), automations, {
			runs,
			task: async (id) => {
				const task = (await deps.tasks.stored()).find((each) => each.id === id);
				return task === undefined
					? null
					: { stage: task.stage, lane: task.lane };
			},
			now: () => "2026-10-19T00:00:00.000Z",
			actions: {
				run: async (command, fired) => {
					if (command === "fail") {
						throw new Error("it broke");
					}
					ran.push(`${command} ${said(fired)}`);
				},
				agent: async (hook, fired) => {
					ran.push(`${hook.agent}: ${hook.prompt} ${said(fired)}`);
				},
			},
			log: new MemoryLogger(),
		});

	const add = (subject: string) => taskAdd(deps, subject, null);

	beforeEach(async () => {
		deps = await Testing.open();
		automations = [
			automation(
				"1",
				{ event: "task.created" },
				{ kind: "run", command: "notify" },
			),
			automation(
				"2",
				{ event: "task.queued" },
				{ kind: "agent", agent: "claude", prompt: "look" },
			),
		];
		runs = new RunStore(deps.storage);
		ran = [];
	});

	afterEach(async () => {
		await deps.disposeAsync();
	});

	it("runs the hooks set on the event, and no others", async () => {
		await fireOn("task.created", 1);
		await fireOn("task.queued", 1);
		await fireOn("task.done");

		expect(ran).toEqual([
			"notify task.created #1",
			"claude: look task.queued #1",
		]);
	});

	it("runs one set to every Nth match on each Nth, counting on", async () => {
		automations = [
			automation(
				"1",
				{ event: "task.created", invokes: 3 },
				{ kind: "run", command: "third" },
			),
		];
		await fireOn("task.created", 1);
		await fireOn("task.created", 2);
		expect(ran).toEqual([]);

		await fireOn("task.created", 3);
		await fireOn("task.created", 4);
		await fireOn("task.created", 5);
		await fireOn("task.created", 6);
		expect(ran).toEqual(["third task.created #3", "third task.created #6"]);
	});

	it("starts an edited every-Nth count over", async () => {
		automations = [
			automation(
				"1",
				{ event: "task.created", invokes: 2 },
				{ kind: "run", command: "second" },
			),
		];
		await fireOn("task.created", 1);
		automations = [{ ...(automations[0] as Automation), editedAt: "later" }];
		await fireOn("task.created", 2);
		expect(ran).toEqual([]);
		await fireOn("task.created", 3);
		expect(ran).toEqual(["second task.created #3"]);
	});

	it("fires a filtered one only for the tasks its filter matches", async () => {
		automations = [
			automation(
				"1",
				{ event: "task.queued", filter: { stages: ["queued"] } },
				{ kind: "run", command: "queued" },
			),
			automation(
				"2",
				{ event: "task.created", filter: { lanes: [1] } },
				{ kind: "run", command: "in lane 1" },
			),
			automation(
				"3",
				{ event: "task.created", filter: { stages: ["running"] } },
				{ kind: "run", command: "never" },
			),
			automation(
				"4",
				{ event: "task.created", filter: { lanes: [0] } },
				{ kind: "run", command: "in Backlog" },
			),
		];
		await add("One");
		await add("Two");
		await queueAdd(deps, [2]);

		await fireOn("task.created", 1, 2);
		await fireOn("task.queued", 1, 2);

		expect(ran).toEqual([
			"in Backlog task.created #1 #2",
			"queued task.queued #2",
		]);
	});

	it("runs nothing paused, and keeps each run with what it failed on", async () => {
		automations = [
			{
				...automation(
					"1",
					{ event: "task.created" },
					{ kind: "run", command: "notify" },
				),
				paused: true,
			},
			automation(
				"2",
				{ event: "task.created" },
				{ kind: "run", command: "fail" },
			),
		];

		await fireOn("task.created", 1);

		expect(ran).toEqual([]);
		expect(await runs.read()).toEqual({
			"2": {
				runs: [
					{
						at: "2026-10-19T00:00:00.000Z",
						on: "task.created #1",
						error: "Error: it broke",
					},
				],
			},
		});
	});
});

function eventOf(name: TaskEventName, numbers: number[]): TaskEvent {
	return { name, from: "", at: "", numbers, task: null };
}

function said(fired: Fired): string {
	if (!("event" in fired)) {
		return "schedule";
	}
	const event: TaskEvent = fired.event;
	return `${event.name}${event.numbers.map((id) => ` #${id}`).join("")}`;
}

function automation(
	id: string,
	trigger: Automation["trigger"],
	hook: Automation["hook"],
): Automation {
	return { id, trigger, hook, createdAt: "2026-10-19T00:00:00.000Z" };
}

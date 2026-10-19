import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { taskAdd } from "../board";
import { queueAdd } from "../queue";
import { Testing } from "../testing";
import type { TaskEvent } from "./events";
import { type Fired, HookRunner } from "./runner";
import { RunStore } from "./runs";
import type { Automation } from "./store";

describe("HookRunner", () => {
	let deps: Testing;
	let automations: Automation[];
	let runs: RunStore;
	let ran: string[];
	let runner: HookRunner | null;
	let timer: FakeTimer;

	/** Has `following` read the journal again, past its throttle, and run what it found. */
	const look = async (following: HookRunner) => {
		void following.changed();
		timer.fireTimeouts();
		await following.changed();
	};

	const follow = async () => {
		runner = await HookRunner.follow({
			journal: deps.journal,
			fs: deps.fs,
			splatesDir: deps.splatesDir,
			automations: async () => automations,
			task: async (id) => {
				const task = (await deps.tasks.stored()).find((each) => each.id === id);
				return task === undefined
					? null
					: { stage: task.stage, lane: task.lane };
			},
			seen: `${deps.splatesDir}/hooks-seen.json`,
			runs,
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
			timer,
		});
		return runner;
	};

	/** Adds task `subject` as `splates task add` does, journaled. */
	const add = (subject: string) =>
		deps.journal.record(
			"task add",
			null,
			() => taskAdd(deps, subject, null),
			(task) => ({
				number: task.id,
				subject: task.subject,
				lane: null,
				position: task.position,
			}),
		);

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
		runs = new RunStore(`${deps.splatesDir}/hooks-runs.json`, deps.fs);
		ran = [];
		runner = null;
		timer = new FakeTimer();
	});

	afterEach(async () => {
		runner?.dispose();
		await deps.disposeAsync();
	});

	it("runs nothing for what came before it first followed", async () => {
		await add("Before");

		await look(await follow());

		expect(ran).toEqual([]);
	});

	it("runs each event's hooks once, in the order the journal took them", async () => {
		const following = await follow();
		await add("Totals first");
		await deps.journal.record(
			"queue add",
			null,
			() => queueAdd(deps, [1]),
			(queued) => ({
				tasks: queued.map((task) => ({ id: task.id, subject: task.subject })),
			}),
		);

		await look(following);
		await look(following);

		expect(ran).toEqual([
			"notify task.created #1",
			"claude: look task.queued #1",
		]);
	});

	it("catches up on what it missed while it was down", async () => {
		(await follow()).dispose();
		await add("While down");

		await look(await follow());

		expect(ran).toEqual(["notify task.created #1"]);
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
		];
		const following = await follow();
		await add("One");
		await add("Two");
		await deps.journal.record(
			"queue add",
			null,
			() => queueAdd(deps, [2]),
			(queued) => ({
				tasks: queued.map((task) => ({ id: task.id, subject: task.subject })),
			}),
		);

		await look(following);

		expect(ran).toEqual(["queued task.queued #2"]);
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
		const following = await follow();
		await add("One");

		await look(following);

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

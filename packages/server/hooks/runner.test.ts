import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { taskAdd } from "../board";
import { queueAdd } from "../queue";
import { Testing } from "../testing";
import type { TaskEvent } from "./events";
import { HookRunner } from "./runner";
import type { Hooks } from "./store";

describe("HookRunner", () => {
	let deps: Testing;
	let hooks: Hooks;
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
			hooks: async () => hooks,
			seen: `${deps.splatesDir}/hooks-seen.json`,
			actions: {
				run: async (command, event) => {
					ran.push(`${command} ${said(event)}`);
				},
				agent: async (hook, event) => {
					ran.push(`${hook.agent}: ${hook.prompt} ${said(event)}`);
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
		hooks = {
			"task.created": [{ kind: "run", command: "notify" }],
			"task.queued": [{ kind: "agent", agent: "claude", prompt: "look" }],
		};
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
});

function said(event: TaskEvent): string {
	return `${event.name}${event.numbers.map((id) => ` #${id}`).join("")}`;
}

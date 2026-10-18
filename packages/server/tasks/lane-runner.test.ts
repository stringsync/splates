import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import type { LaneRecord, TodoState } from "../board";
import { todoAdd, todoUpdate } from "../board";
import { Testing } from "../testing";
import {
	LaneRunner,
	type LaneStart,
	lanePrompt,
	startable,
	taskName,
} from "./lane-runner";

describe("LaneRunner", () => {
	let deps: Testing;
	let lane: LaneRecord;
	let started: LaneStart[];
	/** What a start does once counted: take its todo, as `splates add --todo` does. */
	let starting: (start: LaneStart) => Promise<void>;
	let runner: LaneRunner;

	beforeEach(async () => {
		deps = await Testing.open();
		lane = await deps.todos.addLane("Stats");
		started = [];
		starting = async (each) => {
			await (await deps.todos.find(each.todo.id)).take(each.task);
		};
		runner = LaneRunner.watch({
			lanes: () => deps.todos.lanes(),
			todos: () => deps.todos.stored(),
			tasks: async () => (await deps.service.list()).map(({ task }) => task),
			capacity: 5,
			start: (each) => {
				started.push(each);
				return starting(each);
			},
			log: new MemoryLogger(),
			timer: new FakeTimer(),
		});
	});

	afterEach(async () => {
		runner.dispose();
		await deps[Symbol.asyncDispose]();
	});

	it("starts nothing in a lane that is not running", async () => {
		await todoAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude" },
		});

		await runner.sweep();

		expect(started).toEqual([]);
	});

	it("starts a running lane's unblocked todos as the conversation that ran it, once each", async () => {
		await todoAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude", model: "sonnet" },
		});
		await todoAdd(deps, "Breakdowns", null, {
			lane: lane.id,
			blockedBy: [1],
			assignee: { agent: "claude", model: "sonnet" },
		});
		await deps.todos.runLane(lane.id, { by: "orchestrator" });

		await runner.sweep();
		await settled();
		await runner.sweep();

		expect(
			started.map(({ task, todo, pick, by }) => ({
				task,
				todo: todo.id,
				pick,
				by,
			})),
		).toEqual([
			{
				task: "totals-first",
				todo: 1,
				pick: { agent: "claude", model: "sonnet" },
				by: "orchestrator",
			},
		]);
	});

	it("tries a refused todo again only once it changes", async () => {
		await todoAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude" },
		});
		await deps.todos.runLane(lane.id, { by: null });
		starting = async () => {
			throw new Error("hook_failed");
		};

		await runner.sweep();
		await settled();
		await runner.sweep();
		await settled();
		expect(started).toHaveLength(1);

		await todoUpdate(deps, 1, { text: "with the hook fixed" });
		await runner.sweep();
		expect(started).toHaveLength(2);
	});

	it("keeps a lane running past a rename, and pausing it stops it", async () => {
		await deps.todos.runLane(lane.id, { by: "orchestrator" });
		await deps.todos.renameLane(lane.id, "Stats page");

		expect(await deps.todos.lanes()).toEqual([
			{ id: lane.id, name: "Stats page", running: { by: "orchestrator" } },
		]);

		await deps.todos.runLane(lane.id, null);
		expect(await deps.todos.lanes()).toEqual([
			{ id: lane.id, name: "Stats page" },
		]);
	});

	it("starts every todo no open todo blocks, whatever their order", () => {
		const todos = [
			todo({ id: 1, position: 1 }),
			todo({ id: 2, position: 2, blockedBy: [1] }),
			todo({ id: 3, position: 3 }),
		];

		expect(ready(todos)).toEqual([1, 3]);
	});

	it("holds back a todo a todo in another lane blocks, and starts it once that one is gone", () => {
		const elsewhere = todo({ id: 9, lane: 2 });
		const blocked = todo({ id: 1, blockedBy: [9] });

		expect(ready([blocked, elsewhere])).toEqual([]);
		expect(ready([blocked])).toEqual([1]);
	});

	it("starts no more than the lane has room for beside the tasks it has out", () => {
		const todos = [
			todo({ id: 1, position: 1, takenBy: "one" }),
			todo({ id: 2, position: 2 }),
			todo({ id: 3, position: 3 }),
			todo({ id: 4, position: 4 }),
		];

		expect(ready(todos, { capacity: 3 })).toEqual([2, 3]);
		expect(ready(todos, { capacity: 3, starting: new Set([2]) })).toEqual([3]);
		expect(ready(todos, { capacity: 1 })).toEqual([]);
	});

	it("passes over a refused todo and one naming no agent, so the next gets the room", () => {
		const unnamed = todo({ id: 1, position: 1, assignee: undefined });
		const todos = [
			unnamed,
			todo({ id: 2, position: 2 }),
			todo({ id: 3, position: 3 }),
		];

		expect(ready(todos, { capacity: 1, refused: new Set([2]) })).toEqual([3]);
		expect(
			startable(RUNNING, todos, { capacity: 1, starting: NONE, refused: NONE })
				.unnamed,
		).toEqual([unnamed]);
	});

	it("names a task for its todo's words, cut at a word, numbered past a name taken", () => {
		expect(taskName("Upload retries forever on a 413", NAMES)).toBe(
			"upload-retries-forever-on-a-413",
		);
		expect(
			taskName(
				"Server starts a running lane's unblocked todos on its own, always",
				NAMES,
			),
		).toBe("server-starts-a-running-lane-s-unblocked");
		expect(taskName("Fix it", new Set(["fix-it", "fix-it-2"]))).toBe(
			"fix-it-3",
		);
		expect(taskName("!!!", NAMES)).toBe("todo");
	});

	it("tells the agent its lane and what is out beside it", () => {
		const out = todo({
			id: 1,
			subject: "Totals first",
			takenBy: "totals-first",
		});
		const next = todo({ id: 2, subject: "Breakdowns" });

		const prompt = lanePrompt(RUNNING, next, [out, next]);

		expect(prompt).toContain("lane 1 (Stats)");
		expect(prompt).toContain("totals-first on #1 Totals first");
	});
});

const RUNNING: LaneRecord = { id: 1, name: "Stats", running: { by: null } };
const NONE: ReadonlySet<number> = new Set();
const NAMES: ReadonlySet<string> = new Set();

function todo(overrides: Partial<TodoState>): TodoState {
	return {
		id: 1,
		subject: "a todo",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: 1,
		assignee: { agent: "claude", model: "sonnet" },
		...overrides,
	};
}

/** The ids `startable` starts in `RUNNING`, top first. */
function ready(
	todos: TodoState[],
	{
		capacity = 5,
		starting = NONE,
		refused = NONE,
	}: {
		capacity?: number;
		starting?: ReadonlySet<number>;
		refused?: ReadonlySet<number>;
	} = {},
): number[] {
	return startable(RUNNING, todos, { capacity, starting, refused }).ready.map(
		({ todo }) => todo.id,
	);
}

/** Lets the starts a sweep set going finish. */
function settled(): Promise<void> {
	return Bun.sleep(0);
}

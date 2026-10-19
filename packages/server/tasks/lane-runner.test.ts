import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import type { LaneRecord, TaskRecord } from "../board";
import { taskAdd, taskUpdate } from "../board";
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
	/** What a start does once counted: take its queued task, as `splates add --task` does. */
	let starting: (start: LaneStart) => Promise<void>;
	let runner: LaneRunner;

	beforeEach(async () => {
		deps = await Testing.open();
		lane = await deps.tasks.addLane("Stats");
		started = [];
		starting = async (each) => {
			await (await deps.tasks.find(each.queued.id)).take(each.task);
		};
		runner = LaneRunner.watch({
			lanes: () => deps.tasks.lanes(),
			queued: () => deps.tasks.stored(),
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
		await taskAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude" },
		});

		await runner.sweep();

		expect(started).toEqual([]);
	});

	it("starts a running lane's unblocked queued tasks as the conversation that ran it, once each", async () => {
		await taskAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude", model: "sonnet" },
		});
		await taskAdd(deps, "Breakdowns", null, {
			lane: lane.id,
			blockedBy: [1],
			assignee: { agent: "claude", model: "sonnet" },
		});
		await deps.tasks.runLane(lane.id, { by: "orchestrator" });

		await runner.sweep();
		await settled();
		await runner.sweep();

		expect(
			started.map(({ task, queued, pick, by }) => ({
				task,
				number: queued.id,
				pick,
				by,
			})),
		).toEqual([
			{
				task: "totals-first",
				number: 1,
				pick: { agent: "claude", model: "sonnet" },
				by: "orchestrator",
			},
		]);
	});

	it("tries a refused queued task again only once it changes", async () => {
		await taskAdd(deps, "Totals first", null, {
			lane: lane.id,
			assignee: { agent: "claude" },
		});
		await deps.tasks.runLane(lane.id, { by: null });
		starting = async () => {
			throw new Error("hook_failed");
		};

		await runner.sweep();
		await settled();
		await runner.sweep();
		await settled();
		expect(started).toHaveLength(1);

		await taskUpdate(deps, 1, { text: "with the hook fixed" });
		await runner.sweep();
		expect(started).toHaveLength(2);
	});

	it("keeps a lane running past a rename, and pausing it stops it", async () => {
		await deps.tasks.runLane(lane.id, { by: "orchestrator" });
		await deps.tasks.renameLane(lane.id, "Stats page");

		expect(await deps.tasks.lanes()).toEqual([
			{ id: lane.id, name: "Stats page", running: { by: "orchestrator" } },
		]);

		await deps.tasks.runLane(lane.id, null);
		expect(await deps.tasks.lanes()).toEqual([
			{ id: lane.id, name: "Stats page" },
		]);
	});

	it("starts every queued task no open queued task blocks, whatever their order", () => {
		const all = [
			queued({ id: 1, position: 1 }),
			queued({ id: 2, position: 2, blockedBy: [1] }),
			queued({ id: 3, position: 3 }),
		];

		expect(ready(all)).toEqual([1, 3]);
	});

	it("holds back a queued task a queued task in another lane blocks, and starts it once that one is gone", () => {
		const elsewhere = queued({ id: 9, lane: 2 });
		const blocked = queued({ id: 1, blockedBy: [9] });

		expect(ready([blocked, elsewhere])).toEqual([]);
		expect(ready([blocked])).toEqual([1]);
	});

	it("starts no more than the lane has room for beside the tasks it has out", () => {
		const all = [
			queued({ id: 1, position: 1, takenBy: "one" }),
			queued({ id: 2, position: 2 }),
			queued({ id: 3, position: 3 }),
			queued({ id: 4, position: 4 }),
		];

		expect(ready(all, { capacity: 3 })).toEqual([2, 3]);
		expect(ready(all, { capacity: 3, starting: new Set([2]) })).toEqual([3]);
		expect(ready(all, { capacity: 1 })).toEqual([]);
	});

	it("passes over a refused queued task and one naming no agent, so the next gets the room", () => {
		const unnamed = queued({ id: 1, position: 1, assignee: undefined });
		const all = [
			unnamed,
			queued({ id: 2, position: 2 }),
			queued({ id: 3, position: 3 }),
		];

		expect(ready(all, { capacity: 1, refused: new Set([2]) })).toEqual([3]);
		expect(
			startable(RUNNING, all, { capacity: 1, starting: NONE, refused: NONE })
				.unnamed,
		).toEqual([unnamed]);
	});

	it("holds back a queued task whose blocker was removed without merging", () => {
		const all = [
			queued({
				id: 1,
				position: 1,
				blockersLost: [{ id: 9, subject: "gone" }],
			}),
			queued({ id: 2, position: 2 }),
		];

		expect(ready(all)).toEqual([2]);
	});

	it("names a task for its queued task's words, cut at a word, numbered past a name taken", () => {
		expect(taskName("Upload retries forever on a 413", NAMES)).toBe(
			"upload-retries-forever-on-a-413",
		);
		expect(
			taskName(
				"Server starts a running lane's unblocked queued tasks on its own, always",
				NAMES,
			),
		).toBe("server-starts-a-running-lane-s-unblocked");
		expect(taskName("Fix it", new Set(["fix-it", "fix-it-2"]))).toBe(
			"fix-it-3",
		);
		expect(taskName("!!!", NAMES)).toBe("task");
	});

	it("tells the agent its lane and what is out beside it", () => {
		const out = queued({
			id: 1,
			subject: "Totals first",
			takenBy: "totals-first",
		});
		const next = queued({ id: 2, subject: "Breakdowns" });

		const prompt = lanePrompt(RUNNING, next, [out, next]);

		expect(prompt).toContain("lane 1 (Stats)");
		expect(prompt).toContain("totals-first on #1 Totals first");
	});

	it("tells the agent the commit each queued task it was blocked by landed as", () => {
		const next = queued({
			id: 2,
			blockersLanded: [{ id: 1, subject: "Totals first", commit: "abc1234" }],
		});

		const prompt = lanePrompt(RUNNING, next, [next]);

		expect(prompt).toContain(
			"It was blocked by #1 Totals first, which landed as abc1234: `git show abc1234`",
		);
	});
});

const RUNNING: LaneRecord = { id: 1, name: "Stats", running: { by: null } };
const NONE: ReadonlySet<number> = new Set();
const NAMES: ReadonlySet<string> = new Set();

function queued(overrides: Partial<TaskRecord>): TaskRecord {
	return {
		id: 1,
		subject: "a queued task",
		text: "",
		position: 1,
		from: null,
		createdAt: new Date().toISOString(),
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: 1,
		stage: "ready",
		assignee: { agent: "claude", model: "sonnet" },
		...overrides,
	};
}

/** The ids `startable` starts in `RUNNING`, top first. */
function ready(
	all: TaskRecord[],
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
	return startable(RUNNING, all, { capacity, starting, refused }).ready.map(
		({ queued }) => queued.id,
	);
}

/** Lets the starts a sweep set going finish. */
function settled(): Promise<void> {
	return Bun.sleep(0);
}

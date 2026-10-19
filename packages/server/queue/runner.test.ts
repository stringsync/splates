import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { taskAdd, taskUpdate } from "../board";
import { Testing } from "../testing";
import { queueAdd } from "./commands";
import { QueueRunner, type QueueStart } from "./runner";

describe("QueueRunner", () => {
	let deps: Testing;
	let room: number;
	let started: QueueStart[];
	/** The queued tasks the runner last said wait for a slot, by id. */
	let waiting: number[];
	/** What a start does once counted: take its queued task, as `splates add --task` does. */
	let starting: (start: QueueStart) => Promise<void>;
	let runner: QueueRunner;
	/** Every start under way, for `settled` to wait out. */
	let pending: Promise<void>[];

	/** Waits out every start under way, and the runner's note that it ended. */
	const settled = async (): Promise<void> => {
		await Promise.allSettled(pending);
		await Bun.sleep(0);
	};

	beforeEach(async () => {
		deps = await Testing.open();
		room = 5;
		started = [];
		waiting = [];
		pending = [];
		starting = async (each) => {
			await (await deps.tasks.find(each.queued.id)).take(each.task);
		};
		runner = QueueRunner.watch({
			queued: () => deps.tasks.stored(),
			tasks: async () => (await deps.service.list()).map(({ task }) => task),
			room: () => room,
			want: (each) => {
				waiting = each.map(({ queued }) => queued.id);
			},
			fallback: async () => ({ agent: "claude" }),
			start: (each) => {
				started.push(each);
				const start = starting(each);
				pending.push(start);
				return start;
			},
			log: new MemoryLogger(),
			timer: new FakeTimer(),
		});
	});

	afterEach(async () => {
		runner.dispose();
		await deps[Symbol.asyncDispose]();
	});

	it("starts nothing that is not queued", async () => {
		await taskAdd(deps, "Totals first", null, {
			assignee: { agent: "claude" },
		});

		await runner.sweep();

		expect(started).toEqual([]);
	});

	it("starts queued tasks in dependency order, once each, on the model each names or the fallback", async () => {
		await taskAdd(deps, "Breakdowns", null, {
			assignee: { agent: "claude", model: "sonnet" },
		});
		await taskAdd(deps, "Totals first", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await queueAdd(deps, [1, 2]);

		await runner.sweep();
		await settled();
		await runner.sweep();

		expect(
			started.map(({ task, queued, pick }) => ({
				task,
				number: queued.id,
				pick,
			})),
		).toEqual([{ task: "totals-first", number: 2, pick: { agent: "claude" } }]);
	});

	it("asks the agent to groom the task before working it", async () => {
		await taskAdd(deps, "Raw", null);
		await queueAdd(deps, [1]);

		await runner.sweep();
		await settled();

		expect(started[0]?.prompt).toContain("Groom it first");
	});

	it("starts only as many as the workers have room for, the rest waiting in their line", async () => {
		await taskAdd(deps, "One", null);
		await taskAdd(deps, "Two", null);
		await taskAdd(deps, "Three", null);
		await queueAdd(deps, [1, 2, 3]);
		room = 2;

		await runner.sweep();
		await settled();

		expect(started.map(({ queued }) => queued.id)).toEqual([1, 2]);
		expect(waiting).toEqual([3]);

		room = 0;
		await runner.sweep();
		await settled();
		expect(started).toHaveLength(2);
		expect(waiting).toEqual([3]);

		room = 1;
		await runner.sweep();
		expect(started.map(({ queued }) => queued.id)).toEqual([1, 2, 3]);
		expect(waiting).toEqual([]);
	});

	it("tries a refused queued task again only once it changes", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
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
});

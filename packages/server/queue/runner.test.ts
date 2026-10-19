import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { laneAdd, laneUpdate, taskAdd, taskUpdate } from "../board";
import type { QueueSpot } from "../conversations";
import { Testing } from "../testing";
import { queueAdd, queueRemove } from "./commands";
import {
	type HeldConversation,
	type HeldConversations,
	QueueRunner,
	type QueueStart,
} from "./runner";

describe("QueueRunner", () => {
	let deps: Testing;
	let room: number;
	let started: QueueStart[];
	/** The queued tasks the runner last said wait for a slot, by id. */
	let waiting: number[];
	/**
	 * What a start does once counted: take its queued task, naming its held
	 * conversation, as `splates add --task --held` does.
	 */
	let starting: (start: QueueStart) => Promise<void>;
	let runner: QueueRunner;
	/** Every start under way, for `settled` to wait out. */
	let pending: Promise<void>[];
	let held: FakeHeld;

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
		held = new FakeHeld();
		starting = async (each) => {
			await (await deps.tasks.find(each.queued.id)).take(each.task);
			if (each.held !== undefined) {
				held.hand(each.held);
			}
		};
		runner = QueueRunner.watch({
			queued: () => deps.tasks.stored(),
			lanes: () => deps.tasks.queueFromLanes(),
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
			held,
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

	it("starts the tasks of a lane queued whole as nothing blocks them", async () => {
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "Store licenses", null, { lane: 1 });
		await taskAdd(deps, "Check them", null, { lane: 1, blockedBy: [1] });
		await laneUpdate(deps, 1, { queued: true });

		await runner.sweep();
		await settled();

		expect(started.map(({ queued }) => queued.id)).toEqual([1]);
		expect((await deps.tasks.find(2)).state.stage).toBe("backlog");
	});

	it("asks the agent to groom a task from the backlog before working it, and not one groomed", async () => {
		await taskAdd(deps, "Raw", null);
		await taskAdd(deps, "Groomed", null, { ready: true });
		await queueAdd(deps, [1, 2]);

		await runner.sweep();
		await settled();

		const prompts = new Map(
			started.map(({ queued, prompt }) => [queued.id, prompt]),
		);
		expect(prompts.get(1)).toContain("Groom it first");
		expect(prompts.get(2)).not.toContain("Groom it first");
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

	it("says on its held conversation why a start was refused, and tries it again once asked", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		starting = async () => {
			throw new Error("hook_failed: install exited 1\nat line 3");
		};

		await runner.sweep();
		await settled();
		await runner.sweep();
		expect(held.placed()).toEqual([
			{
				queued: 1,
				position: 1,
				reason: "could not start: hook_failed: install exited 1",
			},
		]);

		starting = async () => {};
		await runner.retry(1);
		expect(started).toHaveLength(2);
	});

	it("holds a conversation for each queued task from the start, placed in queue order with what it waits on", async () => {
		await taskAdd(deps, "Breakdowns", null);
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Someday", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await queueAdd(deps, [1, 2]);
		room = 0;

		await runner.sweep();

		expect(started).toEqual([]);
		expect(held.placed()).toEqual([
			{ queued: 2, position: 1, reason: "no free slot" },
			{ queued: 1, position: 2, reason: "waits on #2" },
		]);

		await runner.sweep();
		expect(held.held).toHaveLength(2);
	});

	it("hands a queued task's held conversation to its start, keeping it until it takes the task", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		room = 0;
		await runner.sweep();
		const [conversation] = held.held;

		room = 1;
		await runner.sweep();
		await settled();
		await runner.sweep();

		expect(started.map((each) => each.held)).toEqual([conversation?.id]);
		expect(held.dropped).toEqual([]);

		held.release(conversation?.id ?? "");
		await runner.sweep();
		expect(held.held).toEqual([]);
	});

	it("drops a held conversation once its task is unqueued or taken another way", async () => {
		await taskAdd(deps, "Unqueued", null);
		await taskAdd(deps, "Taken", null);
		await queueAdd(deps, [1, 2]);
		room = 0;
		await runner.sweep();

		await queueRemove(deps, [1]);
		await (await deps.tasks.find(2)).take("by-hand");
		await runner.sweep();

		expect(held.dropped).toEqual(["h1", "h2"]);
		expect(held.held).toEqual([]);
	});

	it("holds another on the agent its task names once that changes", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		room = 0;
		await runner.sweep();

		await taskUpdate(deps, 1, { assignee: { agent: "codex" } });
		await runner.sweep();

		expect(held.dropped).toEqual(["h1"]);
		expect(held.held.map((each) => each.agent)).toEqual(["codex"]);
	});
});

/**
 * Conversations held for queued tasks, as a list: each held one, where it
 * was last placed, and those dropped.
 */
class FakeHeld implements HeldConversations {
	held: HeldConversation[] = [];
	spots = new Map<string, QueueSpot>();
	dropped: string[] = [];
	#next = 0;

	list = async () => [...this.held];

	hold = async (queued: { id: number }, pick: { agent: string }) => {
		this.#next += 1;
		this.held.push({
			id: `h${this.#next}`,
			queued: queued.id,
			agent: pick.agent,
			createdAt: "2026-10-19T12:00:00.000Z",
			handed: false,
		});
	};

	place = (id: string, spot: QueueSpot) => {
		this.spots.set(id, spot);
	};

	drop = async (id: string) => {
		this.dropped.push(id);
		this.release(id);
	};

	/** Marks `id` as named by the task the queue started, as its record does. */
	hand(id: string): void {
		this.held = this.held.map((each) =>
			each.id === id ? { ...each, handed: true } : each,
		);
	}

	/** Lets `id` go, as taking its task does. */
	release(id: string): void {
		this.held = this.held.filter((each) => each.id !== id);
	}

	/** Each held one's queued task and where it stands, in queue order. */
	placed(): { queued: number; position: number; reason: string }[] {
		return this.held
			.flatMap((each) => {
				const spot = this.spots.get(each.id);
				return spot === undefined
					? []
					: [
							{
								queued: each.queued,
								position: spot.position,
								reason: spot.reason,
							},
						];
			})
			.sort((one, other) => one.position - other.position);
	}
}

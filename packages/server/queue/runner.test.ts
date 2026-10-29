import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { laneAdd, laneQueue, taskAdd, taskUpdate } from "../board";
import type { QueueSpot } from "../conversations";
import { Testing } from "../testing";
import { queueAdd, queueRemove } from "./commands";
import {
	type HeldConversation,
	type HeldConversations,
	QueueRunner,
	type QueueStart,
} from "./runner";
import { FakePicker } from "./testing";

describe("QueueRunner", () => {
	let deps: Testing;
	let started: QueueStart[];
	/**
	 * What a start does once counted: take its queued task, naming its held
	 * conversation, as `splates add --task --held` does.
	 */
	let starting: (start: QueueStart) => Promise<void>;
	let runner: QueueRunner;
	/** Every start under way, for `settled` to wait out. */
	let pending: Promise<void>[];
	let held: FakeHeld;
	let picker: FakePicker;
	let timer: FakeTimer;
	/** Whether the runner is paused, as the server's records say. */
	let paused: boolean;

	/** Waits out every start under way, and the runner's note that it ended. */
	const settled = async (): Promise<void> => {
		await Promise.allSettled(pending);
		await Bun.sleep(0);
	};

	const watch = (): QueueRunner =>
		QueueRunner.watch({
			queued: () => deps.tasks.stored(),
			tasks: async () => (await deps.service.list()).map(({ task }) => task),
			picker,
			start: (each) => {
				started.push(each);
				const start = starting(each);
				pending.push(start);
				return start;
			},
			held,
			paused: () => paused,
			log: new MemoryLogger(),
			timer,
		});

	beforeEach(async () => {
		deps = await Testing.open();
		started = [];
		pending = [];
		held = new FakeHeld();
		picker = new FakePicker();
		timer = new FakeTimer();
		paused = false;
		starting = async (each) => {
			await (await deps.tasks.find(each.queued.id)).take(each.task);
			if (each.held !== undefined) {
				held.hand(each.held);
			}
		};
		runner = watch();
		// `watch` checks the queue at once; left running, that check can read
		// a test's tasks as it queues them and start them before the test does
		await runner.sweep();
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

	it("starts queued tasks in dependency order, once each, on the model each names or Auto pick's", async () => {
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

	it("starts a queued lane's tasks as their blockers land, and keeps one blocked outside it queued", async () => {
		await laneAdd(deps, "Licensing");
		await taskAdd(deps, "Store licenses", null, { lane: 1 });
		await taskAdd(deps, "Check them", null, { lane: 1, blockedBy: [1] });
		await taskAdd(deps, "Elsewhere", null);
		await taskAdd(deps, "Bill them", null, { lane: 1, blockedBy: [3] });
		await laneQueue(deps, 1, true);

		await runner.sweep();
		await settled();

		expect(started.map(({ queued }) => queued.id)).toEqual([1]);
		expect((await deps.tasks.find(2)).state.stage).toBe("queued");
		expect((await deps.tasks.find(4)).state.stage).toBe("queued");

		await (await deps.tasks.find(1)).remove("abc123");
		await runner.sweep();
		await settled();

		expect(started.map(({ queued }) => queued.id)).toEqual([1, 2]);
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

	it("starts nothing while paused, saying so on each held conversation, and starts them on the sweep after a resume", async () => {
		await taskAdd(deps, "One", null);
		await taskAdd(deps, "Two", null, { blockedBy: [1] });
		await queueAdd(deps, [1, 2]);
		paused = true;

		await runner.sweep();
		await settled();
		expect(started).toEqual([]);
		expect(held.placed()).toEqual([
			{ queued: 1, position: 1, reason: "paused" },
		]);

		paused = false;
		await runner.sweep();
		await settled();
		expect(started.map(({ queued }) => queued.id)).toEqual([1]);
	});

	it("starts every queued task nothing blocks at once, taking no slot", async () => {
		await taskAdd(deps, "One", null);
		await taskAdd(deps, "Two", null);
		await taskAdd(deps, "Three", null);
		await queueAdd(deps, [1, 2, 3]);

		await runner.sweep();
		await settled();

		expect(started.map(({ queued }) => queued.id)).toEqual([1, 2, 3]);
	});

	it("tries a refused queued task again after a wait that doubles with each refusal", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		starting = async () => {
			throw new Error("index.lock exists");
		};
		/** Lets a sweep of the clock go by, waiting out what it starts. */
		const sweep = async (): Promise<void> => {
			timer.fireIntervals();
			await runner.sweep();
			await settled();
		};

		await runner.sweep();
		await settled();
		expect(started).toHaveLength(1);

		await sweep();
		expect(started).toHaveLength(2);

		await sweep();
		expect(started).toHaveLength(2);
		await sweep();
		expect(started).toHaveLength(3);

		starting = async (each) => {
			await (await deps.tasks.find(each.queued.id)).take(each.task);
		};
		await sweep();
		await sweep();
		await sweep();
		expect(started).toHaveLength(3);
		await sweep();
		expect(started).toHaveLength(4);
	});

	it("tries a refused queued task again at once when it changes", async () => {
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

	it("holds a conversation only for a queued task that can start, none for one waiting on another", async () => {
		await taskAdd(deps, "Breakdowns", null);
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Someday", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await queueAdd(deps, [1, 2]);
		starting = () => new Promise(() => {});

		await runner.sweep();

		expect(started.map(({ queued }) => queued.id)).toEqual([2]);
		expect(held.placed()).toEqual([
			{ queued: 2, position: 1, reason: "starting" },
		]);

		await runner.sweep();
		expect(held.held).toHaveLength(1);
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");
	});

	it("keeps queued a task waiting on one neither queued nor running, starting that once it is queued", async () => {
		await taskAdd(deps, "Breakdowns", null, { ready: true });
		await taskAdd(deps, "Totals first", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await queueAdd(deps, [1]);

		await runner.sweep();

		expect(started).toEqual([]);
		expect(held.held).toEqual([]);
		const waiting = (await deps.tasks.find(1)).state;
		expect(waiting.stage).toBe("queued");
		expect(waiting.unqueuedFor).toBeUndefined();

		starting = () => new Promise(() => {});
		await queueAdd(deps, [2]);
		await runner.sweep();

		expect(started.map(({ queued }) => queued.id)).toEqual([2]);
		expect((await deps.tasks.find(1)).state.stage).toBe("queued");
	});

	it("keeps queued, unstarted, a task still holding a blocker removed without merging", async () => {
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Breakdowns", null);
		await queueAdd(deps, [2]);
		await (await deps.tasks.find(1)).remove();
		// As a record from before removing a blocker dropped its link.
		await deps.tasks.revise(2, (state) => ({
			...state,
			blockersLost: [{ id: 1, subject: "Totals first" }],
		}));

		await runner.sweep();

		expect(started).toEqual([]);
		const waiting = (await deps.tasks.find(2)).state;
		expect(waiting.stage).toBe("queued");
		expect(waiting.blockersLost?.map((gone) => gone.id)).toEqual([1]);
	});

	it("keeps a chain queued whole when the task at its root is not queued", async () => {
		await taskAdd(deps, "Charts", null);
		await taskAdd(deps, "Breakdowns", null);
		await taskAdd(deps, "Totals first", null);
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await taskUpdate(deps, 2, { blockedBy: [3] });
		await queueAdd(deps, [1, 2]);

		await runner.sweep();

		expect(started).toEqual([]);
		const [one, two] = await Promise.all([
			deps.tasks.find(1),
			deps.tasks.find(2),
		]);
		expect([one.state.stage, two.state.stage]).toEqual(["queued", "queued"]);
	});

	it("hands a queued task's held conversation to its start, keeping it until it takes the task", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		await runner.sweep();
		const [conversation] = held.held;

		await settled();
		await runner.sweep();

		expect(started.map((each) => each.held)).toEqual([conversation?.id]);
		expect(held.dropped).toEqual([]);

		held.release(conversation?.id ?? "");
		await runner.sweep();
		expect(held.held).toEqual([]);
	});

	it("drops a held conversation once its task is unqueued, taken another way, or blocked again", async () => {
		await taskAdd(deps, "Unqueued", null);
		await taskAdd(deps, "Taken", null);
		await taskAdd(deps, "Blocked", null);
		await taskAdd(deps, "Blocker", null);
		await queueAdd(deps, [1, 2, 3]);
		starting = async () => {
			throw new Error("hook_failed");
		};
		await runner.sweep();
		await settled();
		expect(held.held).toHaveLength(3);

		await queueRemove(deps, [1]);
		await (await deps.tasks.find(2)).take("by-hand");
		await (await deps.tasks.find(4)).take("blocker");
		await taskUpdate(deps, 3, { blockedBy: [4] });
		await runner.sweep();

		expect(held.dropped).toEqual(["h1", "h2", "h3"]);
		expect(held.held).toEqual([]);
	});

	it("holds another on the agent its task names once that changes", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		starting = async () => {
			throw new Error("hook_failed");
		};
		await runner.sweep();
		await settled();
		expect(held.held.map((each) => each.agent)).toEqual(["claude"]);

		await taskUpdate(deps, 1, { assignee: { agent: "codex" } });
		await runner.sweep();
		await settled();

		expect(held.dropped).toEqual(["h1"]);
		expect(held.held.map((each) => each.agent)).toEqual(["codex"]);
	});

	it("starts a task that names no agent on what Auto pick decides as it starts, held and told there", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		picker.decides = { agent: "codex", model: "o3", effort: "high" };

		await runner.sweep();
		await settled();

		expect(picker.decided).toEqual([1]);
		expect(started.map(({ pick, held }) => ({ pick, held }))).toEqual([
			{ pick: { agent: "codex", model: "o3", effort: "high" }, held: "h1" },
		]);
		expect(held.dropped).toEqual([]);
		expect(picker.told).toEqual([{ queued: 1, conversation: "h1" }]);
	});

	it("has Auto pick judge a backlog task that names no agent as it is added, not a ready one", async () => {
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Named", null, {
			assignee: { agent: "codex", model: "o3" },
		});
		await taskAdd(deps, "Groomed", null, { ready: true });

		await runner.sweep();
		await settled();

		expect(new Set(picker.aheadOf)).toEqual(new Set([1]));
		expect(picker.guessed).toEqual([]);
		expect(picker.decided).toEqual([]);
		expect(started).toEqual([]);
	});

	it("keeps the agent a task names, asking Auto pick nothing", async () => {
		await taskAdd(deps, "Totals first", null, {
			assignee: { agent: "codex", model: "o3" },
		});
		await queueAdd(deps, [1]);

		await runner.sweep();
		await settled();

		expect(picker.aheadOf).toEqual([]);
		expect(picker.guessed).toEqual([]);
		expect(picker.decided).toEqual([]);
		expect(started.map(({ pick }) => pick)).toEqual([
			{ agent: "codex", model: "o3" },
		]);
	});

	it("leaves to a person's conversation the queued task it took, as a `[SPLATES TASK #N]` start does", async () => {
		await taskAdd(deps, "Totals first", null);
		await taskAdd(deps, "Blocker", null, { assignee: { agent: "claude" } });
		await taskUpdate(deps, 1, { blockedBy: [2] });
		await queueAdd(deps, [1, 2]);
		starting = () => new Promise(() => {});
		await runner.sweep();

		// The person's own agent claims it with `splates add --task 1`.
		await (await deps.tasks.find(1)).take("totals-by-hand");
		await taskUpdate(deps, 1, { removeBlockedBy: [2] });
		await runner.sweep();

		expect(started.map(({ queued }) => queued.id)).toEqual([2]);
		expect(picker.decided).toEqual([]);
		expect(held.held.map(({ queued }) => queued)).toEqual([2]);
	});

	it("tries a refused start again only once its task changes, not for what Auto pick kept on it", async () => {
		await taskAdd(deps, "Totals first", null);
		await queueAdd(deps, [1]);
		picker.keeps = async (queued) => {
			await deps.tasks.store.locked(async () => {
				const record = await deps.tasks.store.read(queued.id);
				await deps.tasks.store.write({
					...(record ?? queued),
					autoPick: {
						pick: { agent: "claude" },
						rule: 0,
						kind: null,
						depth: null,
						reasons: [],
						at: new Date().toISOString(),
					},
				});
			});
		};
		starting = async () => {
			throw new Error("hook_failed");
		};

		await runner.sweep();
		await settled();
		await runner.sweep();
		await settled();

		expect(started).toHaveLength(1);
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

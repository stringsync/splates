import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import type { Agent } from "../agents";
import { FakeAgent } from "../agents/testing";
import { taskAdd, taskUpdate } from "../board";
import { Conversations } from "../conversations";
import { eventually } from "../conversations/testing";
import {
	type HeldConversation,
	type HeldConversations,
	QueueRunner,
	type QueueStart,
	queueAdd,
	queueRemove,
} from "../queue";
import { Testing } from "../testing";
import { QueueAutoPick } from "./index";
import type { Judge } from "./system-one";
import { FakeJudge } from "./testing";

/** A second agent for Auto pick to choose over the one the rules fall back on. */
const OTHER: Agent = { id: "other", name: "Other", argv: ["other-acp"] };

/** A judge sure the task is easy mechanical work. */
const LIGHT_EDIT = {
	"kind:bugfix": 0.9,
	"kind:open": 0.1,
	"depth:shallow": 0.8,
	"depth:deep": 0.1,
};

/** A judge whose provider is down. */
const DOWN: Judge = {
	judge: async () => {
		throw new Error("provider down");
	},
};

describe("QueueAutoPick", () => {
	let deps: Testing;
	let conversations: Conversations;
	let judge: Judge | null;
	let fake: FakeJudge;
	let picker: QueueAutoPick;
	let id: number;
	let started: QueueStart[];
	let runner: QueueRunner;
	let held: ReturnType<typeof heldList>;

	const queued = async () => {
		const record = await deps.tasks.store.read(id);
		if (record === null) {
			throw new Error(`no task #${id}`);
		}
		return record;
	};

	let blocker: number;
	/**
	 * Keeps the task from starting, so only its judgment is seen: blocked by
	 * one under way, which the queue waits on rather than letting it go.
	 */
	const block = async (): Promise<void> => {
		({ id: blocker } = await deps.tasks.add("Blocker", null, {
			assignee: { agent: "fake" },
		}));
		await (await deps.tasks.find(blocker)).take("blocker");
		await taskUpdate(deps, id, { blockedBy: [blocker] });
	};

	beforeEach(async () => {
		deps = await Testing.open();
		conversations = new Conversations(
			`${deps.dir}/conversations`,
			[AGENT, OTHER],
			{
				storage: deps.storage.within("conversations"),
				launch: new FakeAgent().launch,
			},
		);
		fake = new FakeJudge(LIGHT_EDIT);
		judge = fake;
		picker = new QueueAutoPick(deps, conversations, {
			judge: async () => judge,
		});
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({ agents: [ROSTERED, { ...OTHER, models: [] }] }),
		);
		await deps.fs.write(
			`${deps.splatesHome}/auto-pick.json`,
			JSON.stringify({
				format: 2,
				threshold: 0.5,
				rules: [
					{
						kind: "bugfix",
						depth: "shallow",
						picks: [{ agent: "other", model: "small" }],
					},
					{
						kind: "*",
						depth: "*",
						picks: [{ agent: "fake", model: "big" }],
					},
				],
			}),
		);
		({ id } = await deps.tasks.add("Rename `foo` to `bar`", null, {
			text: "In src/names.ts only.",
		}));
		started = [];
		held = heldList();
		runner = QueueRunner.watch({
			queued: () => deps.tasks.stored(),
			tasks: async () => [],
			picker,
			start: async (each) => {
				started.push(each);
				await (await deps.tasks.find(each.queued.id)).take(each.task);
			},
			held: held.conversations,
			log: new MemoryLogger(),
			timer: new FakeTimer(),
		});
	});

	afterEach(async () => {
		runner.dispose();
		await picker.settled();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("decides on the judge's word, keeps it on the task, and logs it in the conversation told", async () => {
		const decided = await picker.decide(await queued());
		expect(decided.pick).toEqual({ agent: "other", model: "small" });
		expect((await queued()).autoPick).toMatchObject({
			pick: { agent: "other", model: "small" },
			kind: "bugfix",
			depth: "shallow",
			classified: { classification: { kinds: {} } },
		});

		const conversation = await conversations.start("other", {
			task: null,
			cwd: deps.root,
			assigned: true,
			heldForTask: id,
		});
		await decided.tell(conversation.id);

		expect(await deps.journal.tail(10)).toContainEqual(
			expect.objectContaining({
				action: "auto",
				conversation: conversation.id,
				agent: "other",
				signs: ["Bugfix 90%", "Shallow 80%"],
			}),
		);
	});

	it("guesses with no judge, and decides the same words again on what the judge said of them", async () => {
		// Words the queue has yet to judge, as it judged the task's first ones when added.
		await runner.sweep();
		await picker.settled();
		await taskUpdate(deps, id, { text: "In src/names.ts and its test." });
		expect((await picker.guess([await queued()])).get(id)).toEqual({
			agent: "fake",
			model: "big",
		});
		expect(fake.asked).toHaveLength(1);

		await picker.decide(await queued());
		const again = await picker.decide(await queued());

		expect(fake.asked).toHaveLength(2);
		expect(again.pick.agent).toBe("other");
		expect((await picker.guess([await queued()])).get(id)?.agent).toBe("other");
	});

	it("takes the rule for any task when the judge fails", async () => {
		judge = DOWN;

		const decided = await picker.decide(await queued());

		expect(decided.pick).toEqual({ agent: "fake", model: "big" });
		const kept = (await queued()).autoPick;
		expect(kept?.classified).toBeUndefined();
		expect(kept?.reasons[1]).toStartWith("the judge failed");
	});

	it("has the queue start a task that names no agent on what Auto pick decides", async () => {
		await queueAdd(deps, [id]);

		await runner.sweep();
		await eventually(async () => started.length === 1);

		expect(started[0]?.pick).toEqual({ agent: "other", model: "small" });
		expect((await queued()).autoPick?.pick.agent).toBe("other");
	});

	it("still starts one with no judge to ask, on the rule for any task", async () => {
		judge = null;
		await queueAdd(deps, [id]);

		await runner.sweep();
		await eventually(async () => started.length === 1);

		expect(started[0]?.pick).toEqual({ agent: "fake", model: "big" });
	});

	it("starts a task that names its agent on that one, judging nothing", async () => {
		const { id: named } = await taskAdd(deps, "Breakdowns", null, {
			assignee: { agent: "other" },
		});
		await queueAdd(deps, [named]);

		await runner.sweep();
		await eventually(async () => started.length === 1);

		await picker.settled();
		expect(started[0]?.pick).toEqual({ agent: "other" });
		expect(fake.asked.map(({ state }) => state.subject)).not.toContain(
			"Breakdowns",
		);
		expect((await deps.tasks.store.read(named))?.autoPick).toBeUndefined();
	});

	it("never decides for a task a person's own conversation took", async () => {
		await runner.sweep();
		await picker.settled();
		const judged = (await queued()).autoPick;
		await queueAdd(deps, [id]);
		// As the person's agent does, told `[SPLATES TASK #N]`.
		await (await deps.tasks.find(id)).take("rename-by-hand");

		await runner.sweep();
		await picker.settled();

		expect(started).toEqual([]);
		expect(fake.asked).toHaveLength(1);
		expect((await queued()).autoPick).toEqual(judged);
	});

	it("judges a task as it is added, before it is queued, and again when its words change", async () => {
		await runner.sweep();
		await picker.settled();

		expect(fake.asked).toHaveLength(1);
		expect((await queued()).stage).not.toBe("queued");
		expect((await queued()).autoPick?.pick).toEqual({
			agent: "other",
			model: "small",
		});

		await taskUpdate(deps, id, { text: "Across every package." });
		await runner.sweep();
		await picker.settled();

		expect(fake.asked).toHaveLength(2);
		expect(started).toEqual([]);
	});

	it("judges a task as it is queued, once, keeping its pick on it", async () => {
		await block();
		await queueAdd(deps, [id]);

		await runner.sweep();
		await picker.settled();
		await runner.sweep();
		await picker.settled();

		expect(fake.asked).toHaveLength(1);
		expect((await queued()).autoPick).toMatchObject({
			pick: { agent: "other", model: "small" },
			classified: { classification: { kinds: {} } },
		});
	});

	it("judges it again when its words change, not when it is queued again as it was", async () => {
		await block();
		await queueAdd(deps, [id]);
		await runner.sweep();
		await picker.settled();

		await queueRemove(deps, [id]);
		await runner.sweep();
		await queueAdd(deps, [id]);
		await runner.sweep();
		await picker.settled();
		expect(fake.asked).toHaveLength(1);

		await taskUpdate(deps, id, { text: "Across every package." });
		await runner.sweep();
		await picker.settled();
		expect(fake.asked).toHaveLength(2);
		expect(fake.asked[1]?.state).toMatchObject({
			detail: "Across every package.",
		});
	});

	it("holds its conversation on the judged pick, so its start swaps nothing", async () => {
		await block();
		// The judgment waits on the test, so no sweep can see it land early.
		const gate = Promise.withResolvers<void>();
		judge = {
			judge: async (judgment) => {
				await gate.promise;
				return fake.judge(judgment);
			},
		};
		await queueAdd(deps, [id]);
		await runner.sweep();
		expect(held.held).toEqual([]);

		gate.resolve();
		await picker.settled();
		await runner.sweep();
		// Blocked, it waits with no conversation held until it can start.
		expect(held.held).toEqual([]);

		await taskUpdate(deps, id, { removeBlockedBy: [blocker] });
		await runner.sweep();
		await eventually(async () => started.length === 1);

		expect(started[0]).toMatchObject({
			held: "h1",
			pick: { agent: "other", model: "small" },
		});
		expect(held.dropped).toEqual([]);
		expect(fake.asked).toHaveLength(1);
	});
});

/** Conversations held for queued tasks, as a list, with those dropped. */
function heldList() {
	const held: HeldConversation[] = [];
	const dropped: string[] = [];
	const conversations: HeldConversations = {
		list: async () => [...held],
		hold: async (queued, pick) => {
			held.push({
				id: `h${held.length + dropped.length + 1}`,
				queued: queued.id,
				agent: pick.agent,
				createdAt: "2026-10-19T12:00:00.000Z",
				handed: false,
			});
		},
		place: () => {},
		drop: async (id) => {
			dropped.push(id);
			held.splice(
				held.findIndex((each) => each.id === id),
				1,
			);
		},
	};
	return { held, dropped, conversations };
}

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

const ROSTERED = {
	id: "fake",
	name: "Fake",
	argv: ["fake-acp"],
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};

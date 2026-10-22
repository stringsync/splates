import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { launcherOf } from "../agents";
import { AGENT, FakeAgent } from "../agents/testing";
import { taskReference } from "../plans";
import { type PoolWorker, Scheduler } from "../workers";
import type { ConversationSlots } from "./host";
import { type Conversation, Conversations } from "./index";
import { eventually, type Held, until } from "./testing";

describe("A conversation whose worker is removed under it", () => {
	let agent: FakeAgent;
	let held: Held;
	let workers: PoolWorker[];
	let scheduler: Scheduler;
	let conversations: Conversations;

	beforeEach(async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo");
		const clock = new FakeWallClock(Date.parse("2026-10-17T10:00:00Z"));
		agent = new FakeAgent();
		held = {};
		agent.turn = async (client, sessionId, text) => {
			if (text === "work") {
				return new Promise((resolve) => (held.finish = resolve));
			}
			if (text === "ask") {
				await client.requestPermission({
					sessionId,
					toolCall: { toolCallId: "t1", title: "rm -rf build" },
					options: [
						{ optionId: "yes", name: "Allow", kind: "allow_once" },
						{ optionId: "no", name: "Reject", kind: "reject_once" },
					],
				});
			}
			return "end_turn";
		};
		const worker = (id: string): PoolWorker => ({
			id,
			slots: 1,
			awake: true,
		});
		workers = [worker("w1"), worker("w2")];
		scheduler = new Scheduler({ workers: () => workers }, clock);
		const slots: ConversationSlots = {
			events: scheduler.events,
			take: async ({ id, task, agent: wants }, signal) => {
				const grant = await scheduler.take(
					{ id, task, agent: wants, project: "/repo" },
					signal,
				);
				return { ...grant, launch: agent.launch };
			},
			hold: ({ id, task, agent: wants }, worker) => {
				const grant = scheduler.hold(
					{ id, task, agent: wants, project: "/repo" },
					worker,
				);
				return {
					...grant,
					dispose: grant.dispose,
					resume: launcherOf(agent.launch).resume,
				};
			},
			spot: () => null,
		};
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer: new FakeTimer(),
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				slots,
				root: "/repo",
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	/** Starts a conversation on task `task`, or none, idle on w1. */
	const start = async (task: string | null = "login") => {
		const conversation = await conversations.start("fake", {
			task,
			cwd: task === null ? "/repo" : `/repo-splates/${task}`,
			capped: true,
		});
		await until(conversation, "idle");
		return conversation;
	};

	/** Takes w1 out of the pool and its slots away, as a forced remove does. */
	const remove = () => {
		workers = workers.filter((each) => each.id !== "w1");
		scheduler.release("w1");
	};

	/** The text of each prompt the agent was sent. */
	const said = () =>
		agent.prompts.map((blocks) =>
			blocks.map((block) => (block.type === "text" ? block.text : "")).join(""),
		);

	it("carries a turn under way on to another worker, in a new session told its task", async () => {
		const conversation = await start();
		void conversation.prompt("work");
		await eventually(() => held.finish !== undefined);
		const sessions = agent.opened.length;

		remove();
		await eventually(() => said().includes(taskReference("login")));
		await until(conversation, "idle");

		expect(agent.launched).toHaveLength(2);
		expect(agent.resumed).toEqual([]);
		expect(agent.opened.length).toBe(sessions + 1);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w2"]);
	});

	it("tells an idle one its task ahead of the person's next words, on another worker", async () => {
		const conversation = await start();

		remove();
		await until(conversation, "stopped");
		expect(agent.launched).toHaveLength(1);
		await conversation.prompt("and now?");
		await eventually(() => said().includes("and now?"));

		expect(said()).toEqual([taskReference("login"), "and now?"]);
		expect(agent.resumed).toEqual([]);
		expect(agent.launched).toHaveLength(2);
	});

	it("leaves one in no task stopped, with nothing pushed to carry on from", async () => {
		const conversation = await start(null);
		void conversation.prompt("work");
		await eventually(() => held.finish !== undefined);

		remove();
		await until(conversation, "stopped");
		await Bun.sleep(0);

		expect(agent.launched).toHaveLength(1);
		expect(scheduler.held()).toEqual([]);
	});

	it("is not taken off a worker it already left", async () => {
		const conversation = await start();
		await conversation.stop();

		remove();
		await Bun.sleep(0);

		expect(conversation.state.status).toBe("stopped");
		expect(agent.launched).toHaveLength(1);
	});

	/** Stops w1 taking new agents, as `splates worker drain w1` does. */
	const drain = () => {
		workers = workers.map((each) =>
			each.id === "w1" ? { ...each, awake: false, draining: true } : each,
		);
		scheduler.poke();
	};

	/** Starts one on task `task`, or none, asking permission on w1. */
	const asking = async (task: string | null = "login") => {
		const conversation = await start(task);
		void conversation.prompt("ask");
		await eventually(() => conversation.state.ask !== null);
		return conversation;
	};

	/** Waits for `conversation`'s agent to let its slot go, keeping its question. */
	const freed = (conversation: Conversation) =>
		eventually(
			() =>
				conversation.state.status === "stopped" &&
				conversation.state.ask !== null,
		);

	it("frees the slot of one asking once its worker drains, keeping the question", async () => {
		const conversation = await asking();

		drain();
		await freed(conversation);

		expect(scheduler.held()).toEqual([]);
		expect(conversation.state.ask).toMatchObject({
			type: "permission",
			id: "t1",
		});
	});

	it("carries it on elsewhere once answered, telling a new session its task and the answer", async () => {
		const conversation = await asking();
		drain();
		await freed(conversation);

		conversation.answer("t1", { type: "permission", option: "yes" });
		await eventually(() => said().length === 3);
		await until(conversation, "idle");

		expect(conversation.state.ask).toBeNull();
		expect(said()).toEqual([
			"ask",
			taskReference("login"),
			"You asked permission for: rm -rf build\nI answered: Allow",
		]);
		expect(agent.resumed).toEqual([]);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w2"]);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w2"]);
	});

	it("drops the question for whatever the person says instead", async () => {
		const conversation = await asking();
		drain();
		await freed(conversation);

		await conversation.prompt("never mind");
		await eventually(() => said().includes("never mind"));

		expect(conversation.state.ask).toBeNull();
		expect(said().slice(-2)).toEqual([taskReference("login"), "never mind"]);
	});

	it("frees one that asks on a worker already draining", async () => {
		const conversation = await start();
		drain();
		await Bun.sleep(0);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w1"]);

		void conversation.prompt("ask");
		await freed(conversation);

		expect(scheduler.held()).toEqual([]);
		expect(conversation.state.ask?.id).toBe("t1");
	});

	it("keeps the slot of one asking in no task, with nothing to carry on from", async () => {
		const conversation = await asking(null);

		drain();
		await Bun.sleep(0);

		expect(conversation.state.status).toBe("running");
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w1"]);
	});

	/** Drains w1 to be replaced, as a rollout updating it does. */
	const replace = () => {
		workers = workers.map((each) =>
			each.id === "w1"
				? { ...each, awake: false, draining: true, replacing: true }
				: each,
		);
		scheduler.poke();
	};

	it("moves an idle one off a worker being replaced, and carries it on elsewhere", async () => {
		const conversation = await start();

		replace();
		await until(conversation, "stopped");

		expect(scheduler.held()).toEqual([]);
		await conversation.prompt("and now?");
		await eventually(() => said().includes("and now?"));
		expect(said()).toEqual([taskReference("login"), "and now?"]);
		expect(agent.resumed).toEqual([]);
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w2"]);
	});

	it("lets one at work on a worker being replaced finish its turn, then moves it", async () => {
		const conversation = await start();
		void conversation.prompt("work");
		await eventually(() => held.finish !== undefined);

		replace();
		await Bun.sleep(0);
		expect(conversation.state.status).toBe("running");

		held.finish?.("end_turn");
		await until(conversation, "stopped");

		expect(scheduler.held()).toEqual([]);
	});

	it("keeps the slot of one in no task on a worker being replaced", async () => {
		const conversation = await start(null);

		replace();
		await Bun.sleep(0);

		expect(conversation.state.status).toBe("idle");
		expect(scheduler.held().map(({ worker }) => worker)).toEqual(["w1"]);
	});
});

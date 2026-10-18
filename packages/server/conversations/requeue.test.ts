import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import { taskReference } from "../plans";
import { type PoolWorker, Scheduler } from "../scheduler";
import type { WorkerMachine } from "../workers";
import type { ConversationSlots, PlacedCheckouts } from "./host";
import { Conversations } from "./index";
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
		agent.turn = (_client, _session, text) =>
			text === "work"
				? new Promise((resolve) => (held.finish = resolve))
				: Promise.resolve("end_turn");
		const worker = (id: string): PoolWorker => ({
			id,
			kind: "registered",
			slots: 1,
			platform: "linux",
			awake: true,
			checkouts: true,
			runs: () => true,
		});
		workers = [worker("w1"), worker("w2")];
		scheduler = new Scheduler({ workers: () => workers }, clock);
		const machine = (id: string): WorkerMachine => ({
			git: async () => ({ code: 0, stdout: "", stderr: "" }),
			processes: async () => [],
			listening: async () => [],
			read: async () => ({ size: 0, bytes: new Uint8Array(0) }),
			exists: async (path) => path.startsWith(`/${id}/`),
			checkout: async () => "",
			removeCheckout: async () => {},
			servers: async () => [],
		});
		const slots: ConversationSlots = {
			events: scheduler.events,
			take: async ({ id, task, agent: wants }, signal) => {
				const grant = await scheduler.take(
					{ id, task, agent: wants, project: "/repo", platform: null },
					signal,
				);
				return {
					...grant,
					launch: agent.launch,
					machine: machine(grant.worker),
				};
			},
			hold: ({ id, task, agent: wants }, worker) =>
				scheduler.hold(
					{ id, task, agent: wants, project: "/repo", platform: null },
					worker,
				),
			spot: () => null,
		};
		// Each worker readies the project's clone, which the agent claims its task from.
		const checkouts: PlacedCheckouts = {
			where: async (worker) => `/${worker}/projects/repo/repo`,
			elsewhere: async () => true,
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
				checkouts,
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
			startedBy: "orchestrator",
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

		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/w1/projects/repo/repo",
			"/w2/projects/repo/repo",
		]);
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
		expect(agent.launched.at(-1)?.cwd).toBe("/w2/projects/repo/repo");
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
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import { type PoolWorker, Scheduler } from "../scheduler";
import type { WorkerMachine } from "../workers";
import type { ConversationSlots, PlacedCheckouts } from "./host";
import { Conversations } from "./index";
import { until } from "./testing";

describe("A conversation placed on a remote worker", () => {
	let agent: FakeAgent;
	let fs: FakeFs;
	/** What exists on the worker, `w1`. */
	let there: Set<string>;
	let machine: WorkerMachine;
	/** What the placement was asked, and what it answers or throws. */
	let asked: { worker: string; task: string | null }[];
	let answer: () => Promise<string>;
	let elsewhere: boolean;
	let scheduler: Scheduler;
	let conversations: Conversations;
	/** The conversations as `splates server` opens them, again after a restart. */
	let open: () => Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo");
		await fs.mkdir("/repo-splates/login");
		const clock = new FakeWallClock(Date.parse("2026-10-17T10:00:00Z"));
		agent = new FakeAgent();
		there = new Set();
		machine = {
			git: async () => ({ code: 0, stdout: "", stderr: "" }),
			processes: async () => [],
			listening: async () => [],
			read: async () => ({ size: 0, bytes: new Uint8Array(0) }),
			exists: async (path) => there.has(path),
			checkout: async () => "",
			removeCheckout: async () => {},
		};
		asked = [];
		answer = async () => "/w1/projects/repo/repo";
		elsewhere = false;
		const workers: PoolWorker[] = [
			{
				id: "w1",
				kind: "registered",
				slots: 2,
				platform: "linux",
				awake: true,
				checkouts: true,
			},
		];
		scheduler = new Scheduler({ workers: () => workers }, clock);
		const slots: ConversationSlots = {
			events: scheduler.events,
			take: async ({ id, task }, signal) => {
				const grant = await scheduler.take(
					{ id, task, project: "/repo", platform: null },
					signal,
				);
				return {
					...grant,
					dispose: grant.dispose,
					launch: agent.launch,
					machine,
				};
			},
			hold: ({ id, task }, worker) =>
				scheduler.hold({ id, task, project: "/repo", platform: null }, worker),
			spot: () => null,
		};
		const checkouts: PlacedCheckouts = {
			where: async (worker, _machine, task) => {
				asked.push({ worker, task });
				return answer();
			},
			elsewhere: async () => elsewhere,
		};
		open = () =>
			new Conversations("/repo/.git/splates/conversations", [AGENT], {
				fs,
				timer: new FakeTimer(),
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				slots,
				checkouts,
				root: "/repo",
			});
		conversations = open();
	});

	afterEach(() => conversations.disposeAsync());

	const start = () =>
		conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
			startedBy: "orchestrator",
		});

	it("starts its agent in the checkout readied there", async () => {
		const conversation = await start();
		await until(conversation, "idle");

		expect(asked).toEqual([{ worker: "w1", task: "login" }]);
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/w1/projects/repo/repo",
		]);
		expect(conversation.cwd).toBe("/w1/projects/repo/repo");
		expect(conversation.placedOn).toBe(machine);
	});

	it("fails, freeing its slot, when the checkout cannot be readied", async () => {
		answer = async () => {
			throw new Error("no central remote");
		};
		const conversation = await start();
		await until(conversation, "failed");

		expect(conversation.state.error).toContain("no central remote");
		expect(agent.launched).toEqual([]);
		expect(scheduler.held()).toEqual([]);
	});

	it("keeps its task on resuming in a clone this machine does not hold", async () => {
		const conversation = await start();
		await until(conversation, "idle");
		// The agent's `splates claim` there moved it into the task's clone.
		conversation.move("login", "/w1/projects/repo/repo-splates.noindex/login");
		there.add("/w1/projects/repo/repo-splates.noindex/login");
		await conversation.stop();
		answer = async () => "/w1/projects/repo/repo-splates.noindex/login";

		await conversation.resume();
		await until(conversation, "idle");

		expect(conversation.state.task).toBe("login");
		expect(agent.launched.at(-1)?.cwd).toBe(
			"/w1/projects/repo/repo-splates.noindex/login",
		);
	});

	it("keeps a task cloned on a worker after a restart, though its clone is not on this machine", async () => {
		const started = await start();
		await until(started, "idle");
		started.move("login", "/w1/projects/repo/repo-splates.noindex/login");
		await conversations.disposeAsync();
		elsewhere = true;
		conversations = open();
		const conversation = await conversations.find(started.id);

		await conversation.resume();
		await until(conversation, "idle");

		expect(conversation.state.task).toBe("login");
	});
});

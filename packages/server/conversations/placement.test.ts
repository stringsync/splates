import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import { type Platform, type PoolWorker, Scheduler } from "../scheduler";
import type { WorkerMachine } from "../workers";
import type { ConversationSlots, PlacedCheckouts } from "./host";
import { Conversations } from "./index";
import { eventually, until } from "./testing";

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
	let workers: PoolWorker[];
	/** The platform the project requires; null for any. */
	let platform: Platform | null;
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
			servers: async () => [WORKER_BROWSER],
		};
		asked = [];
		answer = async () => "/w1/projects/repo/repo";
		elsewhere = false;
		platform = null;
		workers = [LINUX];
		scheduler = new Scheduler({ workers: () => workers }, clock);
		const slots: ConversationSlots = {
			events: scheduler.events,
			take: async ({ id, task, agent: wants, uncapped }, signal) => {
				const grant = await scheduler.take(
					{ id, task, agent: wants, project: "/repo", platform, uncapped },
					signal,
				);
				return {
					...grant,
					dispose: grant.dispose,
					launch: agent.launch,
					machine: grant.worker === "local" ? null : machine,
				};
			},
			hold: ({ id, task, agent: wants, uncapped }, worker) =>
				scheduler.hold(
					{ id, task, agent: wants, project: "/repo", platform, uncapped },
					worker,
				),
			spot: (id) => {
				const entry = scheduler.spot(id);
				return entry === null
					? null
					: {
							position: entry.position,
							of: scheduler.queue().length,
							since: new Date(entry.since).toISOString(),
							reason: entry.reason,
						};
			},
		};
		const checkouts: PlacedCheckouts = {
			where: async (worker, _machine, task) => {
				asked.push({ worker, task });
				return answer();
			},
			elsewhere: async () => elsewhere,
			save: async () => {},
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
				servers: { servers: async () => [COORDINATOR_BROWSER] },
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

	it("offers its agent the browser of the worker it runs on, not this machine's", async () => {
		agent.http = true;
		const conversation = await start();
		await until(conversation, "idle");

		expect(agent.mcp).toEqual([[WORKER_BROWSER]]);
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

	/** The person starts it, in a project that requires Linux, beside this Mac. */
	const own = (...beside: PoolWorker[]) => {
		platform = "linux";
		workers = [MAC, ...beside];
		return conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
	};

	it("starts the person's agent on the Linux worker, not this Mac, though its slots are full", async () => {
		const conversation = await own({ ...LINUX, slots: 0 });
		await until(conversation, "idle");

		expect(conversation.placedOn).toBe(machine);
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/w1/projects/repo/repo",
		]);
		expect(
			scheduler.held().map(({ worker, uncapped }) => ({ worker, uncapped })),
		).toEqual([{ worker: "w1", uncapped: true }]);
	});

	it("keeps the person's agent waiting, saying it needs Linux, while no Linux worker is joined", async () => {
		const conversation = await own();
		await eventually(() => conversation.state.queue?.reason === "needs Linux");
		expect(agent.launched).toEqual([]);

		workers.push(LINUX);
		scheduler.poke();
		await until(conversation, "idle");

		expect(conversation.state.queue).toBeNull();
		expect(conversation.placedOn).toBe(machine);
	});
});

const MAC: PoolWorker = {
	id: "local",
	kind: "local",
	slots: 2,
	platform: "macos",
	awake: true,
	checkouts: true,
	runs: () => true,
};

const LINUX: PoolWorker = {
	id: "w1",
	kind: "registered",
	slots: 2,
	platform: "linux",
	awake: true,
	checkouts: true,
	runs: () => true,
};

const WORKER_BROWSER = {
	type: "http" as const,
	name: "playwright",
	url: "http://localhost:4100/mcp",
	headers: [],
};

const COORDINATOR_BROWSER = {
	...WORKER_BROWSER,
	url: "http://localhost:4200/mcp",
};

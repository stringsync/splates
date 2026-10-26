import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { launcherOf } from "../agents";
import { FakeAgent } from "../agents/testing";
import { type PoolWorker, Scheduler } from "../workers";
import type { ConversationSlots } from "./host";
import { Conversations } from "./index";
import { IDLE_STOP } from "./state";
import { eventually, once, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("Conversations waiting for a slot", () => {
	let timer: FakeTimer;
	let agent: FakeAgent;
	let workers: PoolWorker[];
	let paused: boolean;
	let scheduler: Scheduler;
	let conversations: Conversations;

	beforeEach(async () => {
		const fs = new FakeFs();
		for (const tree of [
			"/repo",
			"/repo-splates/login",
			"/repo-splates/signup",
		]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		const clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		workers = [
			{
				id: "local",
				awake: true,
			},
		];
		paused = false;
		scheduler = new Scheduler(
			{ workers: () => workers, paused: () => paused },
			clock,
		);
		const slots: ConversationSlots = {
			events: scheduler.events,
			take: async (asked, signal) => {
				const grant = await scheduler.take(
					{ ...asked, project: "/repo" },
					signal,
				);
				return {
					worker: grant.worker,
					lost: grant.lost,
					drains: grant.drains,
					replaces: grant.replaces,
					dispose: grant.dispose,
					launch: agent.launch,
					machine: null,
				};
			},
			hold: (asked, worker) => {
				const grant = scheduler.hold({ ...asked, project: "/repo" }, worker);
				return {
					worker: grant.worker,
					lost: grant.lost,
					drains: grant.drains,
					replaces: grant.replaces,
					dispose: grant.dispose,
					resume: launcherOf(agent.launch).resume,
					machine: null,
				};
			},
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
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				slots,
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	/** Starts an agent on `task` as the server's queue starts one. */
	const start = (task: string) =>
		conversations.start("fake", {
			task,
			cwd: `/repo-splates/${task}`,
			automatic: true,
		});

	const restOut = () => {
		for (const entry of timer.timeouts) {
			if (!entry.disposed && entry.delay.ms === IDLE_STOP.ms) {
				entry.disposed = true;
				entry.callback();
			}
		}
	};

	it("starts an agent only once the pool resumes, saying where it waits meanwhile", async () => {
		paused = true;
		const waiting = await start("signup");
		await once(waiting, () => waiting.state.queue !== null);
		expect(waiting.state.status).toBe("starting");
		expect(waiting.state.queue).toEqual({
			position: 1,
			of: 1,
			since: "2026-10-11T10:00:00.000Z",
			reason: "paused",
		});
		expect(agent.launched).toHaveLength(0);

		paused = false;
		scheduler.poke();
		await until(waiting, "idle");
		expect(waiting.state.queue).toBeNull();
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/repo-splates/signup",
		]);
	});

	it("takes a stopped agent out of the queue without starting it", async () => {
		paused = true;
		const waiting = await start("signup");
		await once(waiting, () => waiting.state.queue !== null);

		await waiting.stop();
		expect(waiting.state.status).toBe("stopped");
		expect(waiting.state.queue).toBeNull();
		expect(scheduler.queue()).toEqual([]);
		paused = false;
		scheduler.poke();
		await eventually(() => false, 0);
		expect(agent.launched).toHaveLength(0);
	});

	it("frees an idle agent's slot when it rests, and queues it again on the next prompt", async () => {
		const first = await start("login");
		await until(first, "idle");

		restOut();
		await until(first, "stopped");
		expect(scheduler.held()).toEqual([]);

		paused = true;
		const again = first.prompt("back");
		await once(first, () => first.state.queue !== null);
		expect(first.state.queue?.reason).toBe("paused");
		paused = false;
		scheduler.poke();
		await again;
		await until(first, "idle");
		expect(agent.launched).toHaveLength(2);
	});

	it("starts an agent the person starts at once while the pool is paused", async () => {
		const first = await start("login");
		await until(first, "idle");
		paused = true;
		const own = await conversations.start("fake", { task: null, cwd: "/repo" });
		await until(own, "idle");
		expect(own.state.queue).toBeNull();
		expect(
			scheduler.held().map(({ id, automatic }) => ({ id, automatic })),
		).toEqual([
			{ id: first.id, automatic: true },
			{ id: own.id, automatic: false },
		]);
	});

	it("waits to start an agent the person starts while no worker is up", async () => {
		workers = [];
		const own = await conversations.start("fake", { task: null, cwd: "/repo" });
		await eventually(() => own.state.queue?.reason === "no worker up");
		expect(agent.launched).toHaveLength(0);
		workers = [
			{
				id: "remote",
				awake: true,
			},
		];
		scheduler.poke();
		await until(own, "idle");
		expect(own.state.queue).toBeNull();
	});

	it("frees the slot of an agent that fails to start", async () => {
		agent.dying = 1;
		const first = await start("login");
		await until(first, "failed");
		expect(scheduler.held()).toEqual([]);
	});
});

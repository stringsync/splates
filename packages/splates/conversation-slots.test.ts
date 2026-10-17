import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import type { ConversationSlots } from "./conversation-host";
import { IDLE_STOP } from "./conversation-state";
import { eventually, once, until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";
import { type PoolWorker, Scheduler } from "./scheduler";

describe("Conversations waiting for a slot", () => {
	let timer: FakeTimer;
	let agent: FakeAgent;
	let workers: PoolWorker[];
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
				kind: "local",
				slots: 1,
				platform: "macos",
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
					worker: grant.worker,
					dispose: grant.dispose,
					launch: agent.launch,
					machine: null,
				};
			},
			hold: ({ id, task }, worker) =>
				scheduler.hold({ id, task, project: "/repo", platform: null }, worker),
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

	/** Starts an agent on `task` as a lane's orchestrator hands one out. */
	const start = (task: string) =>
		conversations.start("fake", {
			task,
			cwd: `/repo-splates/${task}`,
			startedBy: "orchestrator",
		});

	const restOut = () => {
		for (const entry of timer.timeouts) {
			if (!entry.disposed && entry.delay.ms === IDLE_STOP.ms) {
				entry.disposed = true;
				entry.callback();
			}
		}
	};

	it("starts an agent only once a slot frees, saying where it waits meanwhile", async () => {
		const first = await start("login");
		await until(first, "idle");
		const second = await start("signup");
		await once(second, () => second.state.queue !== null);
		expect(second.state.status).toBe("starting");
		expect(second.state.queue).toEqual({
			position: 1,
			of: 1,
			since: "2026-10-11T10:00:00.000Z",
			reason: "no free slot",
		});
		expect(agent.launched).toHaveLength(1);

		await first.stop();
		await until(second, "idle");
		expect(second.state.queue).toBeNull();
		expect(agent.launched.map(({ cwd }) => cwd)).toEqual([
			"/repo-splates/login",
			"/repo-splates/signup",
		]);
	});

	it("takes a stopped agent out of the queue without starting it", async () => {
		const first = await start("login");
		await until(first, "idle");
		const second = await start("signup");
		await once(second, () => second.state.queue !== null);

		await second.stop();
		expect(second.state.status).toBe("stopped");
		expect(second.state.queue).toBeNull();
		expect(scheduler.queue()).toEqual([]);
		await first.stop();
		await eventually(() => false, 0);
		expect(agent.launched).toHaveLength(1);
	});

	it("frees an idle agent's slot when it rests, and queues it again on the next prompt", async () => {
		const first = await start("login");
		await until(first, "idle");
		const second = await start("signup");
		await once(second, () => second.state.queue !== null);

		restOut();
		await until(second, "idle");
		expect(first.state.status).toBe("stopped");

		const again = first.prompt("back");
		await once(first, () => first.state.queue !== null);
		await second.stop();
		await again;
		await until(first, "idle");
		expect(agent.launched).toHaveLength(3);
	});

	it("starts an agent the person starts at once, taking no slot", async () => {
		const first = await start("login");
		await until(first, "idle");
		const own = await conversations.start("fake", { task: null, cwd: "/repo" });
		await until(own, "idle");
		expect(own.state.queue).toBeNull();
		expect(scheduler.held().map((held) => held.id)).toEqual([first.id]);
	});

	it("frees the slot of an agent that fails to start", async () => {
		agent.dying = 1;
		const first = await start("login");
		await until(first, "failed");
		expect(scheduler.held()).toEqual([]);
	});
});

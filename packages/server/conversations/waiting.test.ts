import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { launcherOf } from "../agents";
import { AGENT, FakeAgent } from "../agents/testing";
import { type PoolWorker, Scheduler } from "../workers";
import type { ConversationSlots } from "./host";
import { Conversations } from "./index";
import { once, until } from "./testing";

describe("An agent waiting for a slot as the server goes down", () => {
	let agent: FakeAgent;
	let fs: FakeFs;
	let id: string;
	let again: Conversations;

	/** The server's next run, over the same logs, its scheduler holding nothing. */
	const run = (): Conversations => {
		const clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		const workers: PoolWorker[] = [
			{
				id: "local",
				slots: 1,
				awake: true,
			},
		];
		const scheduler = new Scheduler({ workers: () => workers }, clock);
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
			spot: (waiting) => {
				const entry = scheduler.spot(waiting);
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
		return new Conversations("/repo/.git/splates/conversations", [AGENT], {
			fs,
			timer: new FakeTimer(),
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			slots,
		});
	};

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo");
		await fs.mkdir("/repo-splates/login");
		await fs.mkdir("/repo-splates/signup");
		agent = new FakeAgent();
		const before = run();
		const first = await before.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
			capped: true,
		});
		await until(first, "idle");
		const second = await before.start("fake", {
			task: "signup",
			cwd: "/repo-splates/signup",
			capped: true,
		});
		await once(second, () => second.state.queue !== null);
		id = second.id;
		await before.disposeAsync();
		again = run();
	});

	afterEach(() => again.disposeAsync());

	it("starts in the next run, which holds no slots", async () => {
		await until(await again.find(id), "idle");
		expect(agent.launched.map(({ cwd }) => cwd)).toContain(
			"/repo-splates/signup",
		);
	});
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent, FakeAgentPs, say } from "../agents/testing";
import {
	WorkerProcessHost,
	WorkerRegistry,
	WorkerSession,
	WorkerSlots,
} from "../workers";
import { WorkerSocketPair } from "../workers/testing";
import type { Conversation } from "./conversation";
import type { PlacedCheckouts } from "./host";
import { Conversations } from "./index";
import { eventually, until } from "./testing";

const DIR = "/repo/.git/splates/conversations";

describe("A conversation on a registered worker across a coordinator restart", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeClock;
	let agent: FakeAgent;
	/** The Linux worker `box`, beside this Mac's own. */
	let box: WorkerSession;
	let registry: WorkerRegistry;
	let slots: WorkerSlots;
	let pair: WorkerSocketPair;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-splates/login");
		timer = new FakeTimer();
		clock = new FakeClock();
		agent = new FakeAgent();
		const ps = new FakeAgentPs(agent);
		box = new WorkerSession("worker", { timer, clock });
		box.events.on(
			"channel",
			(channel) => new WorkerProcessHost(channel, box, ps),
		);
		coordinate();
		await link();
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		slots.dispose();
		registry.dispose();
		box.dispose();
	});

	/**
	 * A coordinator as `splates server` makes one: its registry, knowing
	 * `box` from its record before it dials, its slots, and the project's
	 * conversations, which require Linux, over the one log directory.
	 */
	const coordinate = () => {
		registry = new WorkerRegistry(
			{ info: () => {}, error: () => {} },
			{ session: { id: "coordinator-1", acks: "manual" }, timer, clock },
		);
		const local = registry.expect("local", "local");
		registry.expect("box");
		slots = new WorkerSlots(registry, { platform: "darwin" });
		const checkouts: PlacedCheckouts = {
			where: async (worker) => `/${worker}/projects/repo/repo`,
			elsewhere: async () => true,
			save: async () => {},
		};
		conversations = new Conversations(DIR, [AGENT], {
			fs,
			timer,
			clock: new FakeWallClock(Date.parse("2026-10-18T10:00:00Z")),
			ids: new CounterIdProvider(),
			launcher: local,
			machine: local,
			slots: slots.project("/repo", "linux"),
			checkouts,
		});
	};

	/** Links `box` to the registry over a new connection. */
	const link = async () => {
		pair = new WorkerSocketPair();
		const connecting = box.connect(pair.worker, {
			id: "box",
			info: { platform: "linux", slots: 2, checkouts: true },
		});
		await registry.accept(pair.coordinator);
		await connecting;
	};

	/** Lets the log save and the acks go out, as time would. */
	const settle = async () => {
		for (let i = 0; i < 3; i++) {
			timer.fireTimeouts();
			await Bun.sleep(0);
		}
	};

	/**
	 * The coordinator restarts: lets its agents go, hangs up, and a new one
	 * reads the logs, `box` dialing it only after.
	 */
	const restart = async ({ known = true } = {}) => {
		await conversations.detachAsync();
		const detached = registry.detach();
		timer.fireTimeouts();
		await detached;
		pair.drop();
		slots.dispose();
		coordinate();
		if (!known) {
			registry.forget("box");
		}
		return conversations.list();
	};

	const words = (conversation: Conversation) =>
		conversation.state.messages.map((each) =>
			each.parts
				.map((part) => (part.type === "text" ? part.text : ""))
				.join(""),
		);

	/**
	 * The person's conversation, mid-turn on `box`, its log saved: its
	 * agent has said its first word, and says its second once `held` settles.
	 */
	const midTurn = async (held: Promise<void> = new Promise(() => {})) => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Hi.") });
			await held;
			await client.sessionUpdate({ sessionId, update: say(" Bye.") });
			return "end_turn";
		};
		const before = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(before, "idle");
		expect(before.placedOn).toBe(registry.worker("box") ?? null);
		await before.prompt("one");
		await eventually(() => words(before).includes("Hi."));
		await settle();
		return before;
	};

	it("takes its agent back on the worker once it rejoins, placed there and holding its slot", async () => {
		const { promise: held, resolve: goOn } = Promise.withResolvers<void>();
		const before = await midTurn(held);

		const [after] = await restart();
		expect(after?.id).toBe(before.id);
		expect(after?.state.status).toBe("running");
		expect(after?.placedOn).toBe(registry.worker("box") ?? null);
		expect(slots.scheduler.held().map(({ worker }) => worker)).toEqual(["box"]);
		await link();
		goOn();
		await until(after as Conversation, "idle");

		expect(words(after as Conversation)).toEqual(["one", "Hi. Bye."]);
		expect(agent.launched).toHaveLength(1);
		expect(agent.killed).toBe(0);
	});

	it("stops it, holding no slot, and the worker ends it, when its worker is no longer known", async () => {
		await midTurn();

		const [after] = await restart({ known: false });

		expect(after?.state.status).toBe("stopped");
		expect(after?.placedOn).toBeNull();
		expect(slots.scheduler.held()).toEqual([]);
		// The worker ends what nobody took back once it dials.
		await link();
		await eventually(() => agent.killed === 1);
	});
});

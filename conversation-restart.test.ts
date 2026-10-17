import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import type { Conversation } from "./conversation";
import type { Entry } from "./conversation-log";
import { eventually, until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";
import { FakeAgentPs } from "./fake-agent-ps";
import { RemoteWorker } from "./remote-worker";
import { WorkerProcessHost } from "./worker-process-host";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

const DIR = "/repo/.git/arbor/conversations";

describe("A conversation on a worker across a coordinator restart", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeClock;
	let agent: FakeAgent;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let pair: WorkerSocketPair;
	let conversations: Conversations;
	/** Lets the agent's turn go on to its second word. */
	let goOn: () => void;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		timer = new FakeTimer();
		clock = new FakeClock();
		agent = new FakeAgent();
		const held = new Promise<void>((resolve) => {
			goOn = resolve;
		});
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Hi.") });
			await held;
			await client.sessionUpdate({ sessionId, update: say(" Bye.") });
			return "end_turn";
		};
		const ps = new FakeAgentPs(agent);
		worker = new WorkerSession("worker", { timer, clock });
		worker.events.on(
			"channel",
			(channel) => new WorkerProcessHost(channel, worker, ps),
		);
		coordinator = session();
		conversations = talk(coordinator);
		await link();
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		worker.dispose();
		coordinator.dispose();
	});

	/** A coordinator session as `arbor dev` makes one: named, acking by hand. */
	const session = () =>
		new WorkerSession("coordinator", {
			id: "coordinator-1",
			acks: "manual",
			timer,
			clock,
		});

	/** The conversations of a coordinator running `session`, over the one log directory. */
	const talk = (session: WorkerSession) => {
		const remote = new RemoteWorker("local", {}, session);
		return new Conversations(DIR, [AGENT, { ...AGENT, id: "opencode" }], {
			fs,
			timer,
			clock: new FakeWallClock(Date.parse("2026-10-16T10:00:00Z")),
			ids: new CounterIdProvider(),
			launcher: remote,
			machine: remote,
		});
	};

	/** Links the worker to `coordinator` over a new connection. */
	const link = async () => {
		pair = new WorkerSocketPair();
		const connecting = worker.connect(pair.worker, { id: "local" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
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
	 * The coordinator restarts: lets its agents go, hangs up, and one with
	 * the same session id reads the logs and takes the worker back.
	 */
	const restart = async () => {
		await conversations.detachAsync();
		// The worker's acks go out on a timer.
		const acked = coordinator.acked();
		timer.fireTimeouts();
		await acked;
		coordinator.detach();
		pair.drop();
		coordinator = session();
		conversations = talk(coordinator);
		const read = await conversations.list();
		await link();
		return read;
	};

	/** Each line of conversation `id`'s log. */
	const logged = async (id: string): Promise<Entry[]> =>
		(await fs.read(`${DIR}/${id}.jsonl`))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Entry);

	/** What the agent said in `conversation`, as the thread shows it. */
	const words = (conversation: Conversation) =>
		conversation.state.messages.map((each) =>
			each.parts
				.map((part) => (part.type === "text" ? part.text : ""))
				.join(""),
		);

	it("finds the turn running on the process it takes back, and ends it once, logged once", async () => {
		const before = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(before, "idle");
		await before.prompt("one");
		await eventually(() => words(before).includes("Hi."));
		await settle();

		const [after] = await restart();
		expect(after?.id).toBe(before.id);
		expect(after?.state.status).toBe("running");
		expect(agent.launched).toHaveLength(1);
		goOn();
		await until(after as Conversation, "idle");

		expect(words(after as Conversation)).toEqual(["one", "Hi. Bye."]);
		expect(agent.killed).toBe(0);
		expect(agent.prompts).toHaveLength(1);
		const kinds = (await logged(before.id)).map((each) => each.kind);
		expect(kinds.filter((kind) => kind === "update")).toHaveLength(2);
		expect(kinds.filter((kind) => kind === "launched")).toHaveLength(1);
	});

	it("keeps a requested provider-qualified model and absent steering across worker reattachment", async () => {
		const model = "opencode-go/fixture";
		agent.options = [
			{
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: model,
				options: [{ value: model, name: "Fixture" }],
			},
		];
		const before = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
			model,
		});
		await until(before, "idle");
		await before.prompt("one");
		await eventually(() => words(before).includes("Hi."));
		await settle();
		const [after] = await restart();
		await after?.prompt("queued");
		expect(agent.prompts).toHaveLength(1);
		expect(agent.steered).toEqual([]);
		expect(after?.state.settings[0]?.current).toBe(model);
		goOn();
		await eventually(() => agent.prompts.length === 2);
		await until(after as Conversation, "idle");
		expect(agent.launched).toHaveLength(1);
		expect(agent.prompts).toHaveLength(2);
	});

	it("fills the in-flight OpenCode usage once after reattachment", async () => {
		agent.usage = { inputTokens: 42, outputTokens: 7, totalTokens: 49 };
		const before = await conversations.start("opencode", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(before, "idle");
		await before.prompt("one");
		await eventually(() => words(before).includes("Hi."));
		await settle();
		const [after] = await restart();
		goOn();
		await until(after as Conversation, "idle");
		expect(after?.state.usage.opencode?.turns).toHaveLength(1);
		expect(after?.state.usage.opencode?.turns[0]?.tokens?.input).toBe(42);
		expect(after?.state.usage.opencode?.turns[0]?.until).not.toBeNull();
		await after?.saved();
		const [again] = await restart();
		expect(again?.state.usage.opencode).toEqual(after?.state.usage.opencode);
		expect(agent.prompts).toHaveLength(1);
	});

	it("reads the same conversation back idle from its log, and carries on with the next prompt", async () => {
		const before = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(before, "idle");
		await before.saved();

		const [after] = await restart();
		expect(after?.state.status).toBe("idle");
		goOn();
		await after?.prompt("two");
		await until(after as Conversation, "idle");

		expect(words(after as Conversation)).toEqual(["two", "Hi. Bye."]);
		expect(agent.launched).toHaveLength(1);
	});

	it("stops a conversation whose process the worker no longer holds, as one idled out", async () => {
		const before = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(before, "idle");
		await before.saved();
		await conversations.detachAsync();
		coordinator.detach();
		pair.drop();
		// The worker started again too, with nothing from before.
		worker.dispose();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = session();
		conversations = talk(coordinator);

		const [after] = await conversations.list();
		await link();
		await eventually(() => after?.state.status === "stopped");

		expect(after?.state.error).toBeNull();
	});
});

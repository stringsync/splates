import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeClock, FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";
import { FakeAgentPs } from "./fake-agent-ps";
import { RemoteWorker } from "./remote-worker";
import { WorkerProcessHost } from "./worker-process-host";
import { WorkerSession } from "./worker-session";
import { WorkerSocketPair } from "./worker-socket-pair";

describe("A conversation on a worker", () => {
	let agent: FakeAgent;
	let worker: WorkerSession;
	let coordinator: WorkerSession;
	let conversations: Conversations;

	beforeEach(async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		const timer = new FakeTimer();
		const clock = new FakeClock();
		agent = new FakeAgent();
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Hi.") });
			return "end_turn";
		};
		const ps = new FakeAgentPs(agent);
		const pair = new WorkerSocketPair();
		worker = new WorkerSession("worker", { timer, clock });
		coordinator = new WorkerSession("coordinator", { timer, clock });
		worker.events.on(
			"channel",
			(channel) => new WorkerProcessHost(channel, worker, ps),
		);
		const connecting = worker.connect(pair.worker, { id: "local" });
		coordinator.accept(
			pair.coordinator,
			await WorkerSession.hello(pair.coordinator),
		);
		await connecting;
		const remote = new RemoteWorker("local", {}, coordinator);
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock: new FakeWallClock(Date.parse("2026-10-16T10:00:00Z")),
				ids: new CounterIdProvider(),
				launch: remote.launch,
				machine: remote,
			},
		);
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		worker.dispose();
		coordinator.dispose();
	});

	it("starts its agent on the worker, in its tree", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");

		expect(agent.launched).toMatchObject([
			{ argv: AGENT.argv, cwd: "/repo-arbor/login" },
		]);
	});

	it("carries a prompt to the agent and its answer back", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await conversation.prompt("hello");
		await until(conversation, "idle");

		expect(conversation.state.messages).toMatchObject([
			{ role: "user", parts: [{ type: "text", text: "hello" }] },
			{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
		]);
	});

	it("kills the agent on the worker when stopped", async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");

		await conversation.stop();

		expect(agent.killed).toBe(1);
	});
});

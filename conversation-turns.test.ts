import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	eventually,
	finish,
	type Held,
	thread,
	until,
	working,
} from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";

describe("Conversation turns", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		// The trees the agents run in, which a resume looks for.
		for (const tree of ["/repo", "/repo-arbor/login", "/repo-arbor/signup"]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
	});

	afterEach(() => conversations.disposeAsync());

	const started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	let held: Held;
	let said: string[];

	let client: acp.AgentSideConnection | undefined;

	beforeEach(() => {
		held = {};
		said = [];
		agent.turn = (connection, _session, text) => {
			client = connection;
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
	});

	/** What Claude sends as a turn ends, saying where the turn came from. */
	const result = (kind: string): acp.SessionUpdate => ({
		sessionUpdate: "usage_update",
		used: 1,
		size: 10,
		_meta: { "_claude/origin": { kind } },
	});

	/** Ends a turn on "one", then has the agent start one of its own. */
	const unprompted = async () => {
		const conversation = await working(conversations, held);
		await update(result("human"));
		await finish(conversation, held);
		await client?.sessionUpdate({
			sessionId: "s1",
			update: say("The tests passed."),
		});
		return conversation;
	};

	const update = async (update: acp.SessionUpdate) => {
		await client?.sessionUpdate({ sessionId: "s1", update });
	};

	it("runs a turn, folding streamed text and tool calls into one message", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Reading ") });
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "cat note.txt",
					status: "in_progress",
				},
			});
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "completed",
				},
			});
			await client.sessionUpdate({ sessionId, update: say("it says ") });
			await client.sessionUpdate({ sessionId, update: say("hi.") });
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "session_info_update",
					title: "Read the note",
				},
			});
			return "end_turn";
		};
		const conversation = await started();

		await conversation.prompt("  what does note.txt say?  ");
		expect(conversation.state.status).toBe("running");
		await until(conversation, "idle");

		expect(conversation.state.title).toBe("Read the note");
		expect(conversation.state.messages).toMatchObject([
			{
				role: "user",
				parts: [{ type: "text", text: "what does note.txt say?" }],
			},
			{
				role: "agent",
				parts: [
					{ type: "text", text: "Reading " },
					{
						type: "tool",
						id: "t1",
						title: "cat note.txt",
						status: "completed",
					},
					{ type: "text", text: "it says hi." },
				],
			},
		]);
	});

	it("joins the running turn when the agent steers", async () => {
		agent.steering = "injected";
		const conversation = await working(conversations, held);

		await conversation.prompt("two");

		expect(agent.steered).toEqual(["two"]);
		expect(conversation.state.status).toBe("running");
		expect(thread(conversation)).toEqual([
			["one", false],
			["two", false],
		]);
		await finish(conversation, held);
		expect(said).toEqual(["one"]);
	});

	it("marks a message the agent steered in, after a restart too", async () => {
		agent.steering = "injected";
		const conversation = await working(conversations, held);

		await conversation.prompt("two");
		await finish(conversation, held);
		await conversation.stop();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();

		const steered = (each: Conversation | undefined) =>
			each?.state.messages
				.filter((message) => message.role === "user")
				.map((message) => message.steered ?? false);
		expect([steered(conversation), steered(read)]).toEqual([
			[false, true],
			[false, true],
		]);
	});

	it("gives each message said while the agent starts a turn of its own, even when it steers", async () => {
		agent.steering = "injected";
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});

		await Promise.all([conversation.prompt("one"), conversation.prompt("two")]);

		expect(agent.steered).toEqual([]);
		expect(thread(conversation)).toEqual([
			["one", false],
			["two", true],
		]);
		await eventually(() => held.finish !== undefined);
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two"]);
		await finish(conversation, held);
	});

	it("waits for the turn's end when the agent finds no turn to steer", async () => {
		// As when the agent ended its turn, and arbor has yet to hear.
		agent.steering = "promptRequired";
		const conversation = await working(conversations, held);

		await conversation.prompt("two");

		expect(thread(conversation).at(-1)).toEqual(["two", true]);
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two"]);
		await finish(conversation, held);
	});

	it("runs until the agent says that turn ended", async () => {
		const conversation = await unprompted();

		expect(conversation.state.status).toBe("running");
		await update({ sessionUpdate: "usage_update", used: 1, size: 10 });
		expect(conversation.state.status).toBe("running");
		await update(result("task-notification"));
		expect(conversation.state.status).toBe("idle");
	});

	it("starts none for an agent that never says a turn ended", async () => {
		const conversation = await working(conversations, held);
		await finish(conversation, held);

		await update(say("A late word."));

		expect(conversation.state.status).toBe("idle");
	});

	it("starts no turn on a tool call's late word", async () => {
		const conversation = await working(conversations, held);
		await update(result("human"));
		await finish(conversation, held);

		await update({
			sessionUpdate: "tool_call_update",
			toolCallId: "t1",
			status: "completed",
		});

		expect(conversation.state.status).toBe("idle");
	});

	it("queues what is said meanwhile for its end, when the agent cannot steer", async () => {
		const conversation = await unprompted();

		await conversation.prompt("two");

		expect(thread(conversation).at(-1)).toEqual(["two", true]);
		expect(said).toEqual(["one"]);
		await update(result("task-notification"));
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two"]);
		await finish(conversation, held);
	});

	it("steers what is said meanwhile into it, when the agent can", async () => {
		agent.steering = "injected";
		const conversation = await unprompted();

		await conversation.prompt("two");

		expect(agent.steered).toEqual(["two"]);
		expect(thread(conversation).at(-1)).toEqual(["two", false]);
		await update(result("task-notification"));
		expect(conversation.state.status).toBe("idle");
		expect(said).toEqual(["one"]);
	});

	it("marks the turn the person stopped, and reads the mark back from its log", async () => {
		const conversation = await working(conversations, held);

		await conversation.cancel();
		await finish(conversation, held);

		const [, reply] = conversation.state.messages;
		const stopped = reply?.stopped;
		expect(reply?.role).toBe("agent");
		expect(typeof stopped).toBe("string");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.messages.at(-1)?.stopped).toBe(stopped);
		await reread.disposeAsync();
	});

	it("marks the turn a crash cut short, and reads the mark back from its log", async () => {
		const conversation = await working(conversations, held);

		agent.crash();
		await until(conversation, "failed");

		const [, reply] = conversation.state.messages;
		const interrupted = reply?.interrupted;
		expect(reply?.role).toBe("agent");
		expect(typeof interrupted).toBe("string");
		expect(reply?.stopped).toBeUndefined();
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.messages.at(-1)?.interrupted).toBe(interrupted);
		await reread.disposeAsync();
	});

	it("marks the turn running when the server stops it", async () => {
		const conversation = await working(conversations, held);

		await conversations.disposeAsync();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(typeof read?.state.messages.at(-1)?.interrupted).toBe("string");
		expect(conversation.state.status).toBe("stopped");
		await reread.disposeAsync();
	});

	it("marks the turn running when the server is killed, and keeps the mark when read again", async () => {
		await working(conversations, held);
		// What the throttled log has yet to save, saved as the agent streams.
		timer.fireTimeouts();
		await Bun.sleep(1);

		// Read as the next server would, the first never having stopped.
		const next = () =>
			new Conversations("/repo/.git/arbor/conversations", [AGENT], {
				fs,
				timer,
				launch: agent.launch,
			});
		const reread = next();
		const [read] = await reread.list();
		const interrupted = read?.state.messages.at(-1)?.interrupted;
		expect(typeof interrupted).toBe("string");
		expect(read?.state.messages.at(-1)?.role).toBe("agent");
		await reread.disposeAsync();

		const again = next();
		const [after] = await again.list();
		expect(after?.state.messages.at(-1)?.interrupted).toBe(interrupted);
		await again.disposeAsync();
	});
});

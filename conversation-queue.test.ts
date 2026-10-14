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
import { Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";

describe("Conversation queue", () => {
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

	const _started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	let held: Held;
	let said: string[];

	beforeEach(() => {
		held = {};
		said = [];
		agent.turn = (_client, _session, text) => {
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
	});

	it("waits for the turn to end when the agent cannot steer, then says all that waited as one prompt", async () => {
		let client: acp.AgentSideConnection | undefined;
		agent.turn = (connection, _session, text) => {
			client = connection;
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
		const conversation = await working(conversations, held);

		await conversation.prompt("two");
		await conversation.prompt("three");

		expect(thread(conversation)).toEqual([
			["one", false],
			["two", true],
			["three", true],
		]);
		await client?.sessionUpdate({
			sessionId: "s1",
			update: say("Still on one."),
		});
		await eventually(() => conversation.state.messages.length === 4);
		// Below what the agent says meanwhile, since it has yet to hear them.
		expect(thread(conversation)).toEqual([
			["one", false],
			["Still on one.", false],
			["two", true],
			["three", true],
		]);
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two\n\nthree"]);
		expect(conversation.state.status).toBe("running");
		expect(thread(conversation)).toEqual([
			["one", false],
			["Still on one.", false],
			["two", false],
			["three", false],
		]);
		await finish(conversation, held);
	});

	it("holds a queued message's images for the turn's end, and hands them back when it is taken back", async () => {
		agent.sees = true;
		const conversation = await working(conversations, held);
		const png = {
			title: "shot.png",
			mimeType: "image/png",
			bytes: new TextEncoder().encode("png bytes"),
		};

		await conversation.prompt("two", [png]);
		await conversation.prompt("three", [png]);

		expect(conversation.unqueue(1)).toEqual({
			text: "three",
			files: [
				{
					name: expect.stringMatching(/\.png$/),
					title: expect.stringMatching(/\.png$/),
					mimeType: "image/png",
				},
			],
		});
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(agent.prompts.at(-1)).toEqual([
			{ type: "image", mimeType: "image/png", data: btoa("png bytes") },
			{ type: "text", text: "two" },
		]);
		await finish(conversation, held);
	});

	it("holds what waited when the turn is cancelled, until the next message", async () => {
		const conversation = await working(conversations, held);
		await conversation.prompt("two");

		await conversation.cancel();
		await finish(conversation, held);

		expect(said).toEqual(["one"]);
		expect(thread(conversation).at(-1)).toEqual(["two", true]);
		await conversation.prompt("three");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two\n\nthree"]);
		await finish(conversation, held);
	});

	it("takes back a queued message, answering with its words", async () => {
		const conversation = await working(conversations, held);
		await conversation.prompt("two");
		await conversation.prompt("three");

		expect(conversation.unqueue(0)).toEqual({ text: "two", files: [] });

		expect(thread(conversation)).toEqual([
			["one", false],
			["three", true],
		]);
		expect(() => conversation.unqueue(5)).toThrow(
			"conversation 0 has no queued message 5",
		);
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		// Stopped mid-turn, the turn reads back as cut short.
		expect(read && thread(read)).toEqual([
			["one", false],
			["", false],
			["three", true],
		]);
		await reread.disposeAsync();
	});

	it("sends what is queued now by stopping the turn", async () => {
		agent.turn = (_client, _session, text) => {
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
		const conversation = await working(conversations, held);
		await conversation.prompt("two");

		await conversation.sendNow();
		// The agent stops the turn it was asked to cancel.
		held.finish?.("cancelled");
		await eventually(() => said.length === 2);

		expect(agent.cancelled).toBe(1);
		expect(said).toEqual(["one", "two"]);
		// Stopped to send, not by the person.
		expect(conversation.state.messages.some((each) => each.stopped)).toBe(
			false,
		);
		await finish(conversation, held);
	});

	it("reads back what still waits from its log", async () => {
		const conversation = await working(conversations, held);
		await conversation.prompt("two");
		await conversation.stop();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();

		// Stopped mid-turn, the turn reads back as cut short.
		expect(read && thread(read)).toEqual([
			["one", false],
			["", false],
			["two", true],
		]);
		await reread.disposeAsync();
	});
});

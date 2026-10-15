import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { eventually, finish, type Held, until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";
import { DICTATED } from "./prompts";

describe("A conversation said something into the mic", () => {
	let fs: FakeFs;
	let held: Held;
	let agent: FakeAgent;
	let conversations: Conversations;
	let conversation: Conversation;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		held = {};
		agent = new FakeAgent();
		agent.turn = () => new Promise((resolve) => (held.finish = resolve));
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer: new FakeTimer(),
				clock: new FakeWallClock(Date.parse("2026-10-15T10:00:00Z")),
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
		conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
	});

	afterEach(() => conversations.disposeAsync());

	const told = () =>
		agent.prompts.map((prompt) =>
			prompt.map((block) => (block.type === "text" ? block.text : "")).join(""),
		);

	it("tells the agent alone to read it as speech, and keeps that it was dictated", async () => {
		await conversation.prompt("fix the a bore page", [], undefined, {
			dictated: true,
		});
		await eventually(() => held.finish !== undefined);
		await finish(conversation, held);
		await conversation.stop();

		expect(told()).toEqual([`fix the a bore page\n\n${DICTATED}`]);
		expect(conversation.state.messages[0]).toMatchObject({
			dictated: true,
			parts: [{ type: "text", text: "fix the a bore page" }],
		});
		expect(
			await fs.read(`/repo/.git/arbor/conversations/${conversation.id}.jsonl`),
		).toContain('"dictated":true');
	});

	it("says nothing of speech for a message typed", async () => {
		await conversation.prompt("fix the arbor page");
		await eventually(() => held.finish !== undefined);
		await finish(conversation, held);

		expect(told()).toEqual(["fix the arbor page"]);
		expect(conversation.state.messages[0]?.dictated).toBeUndefined();
	});
});

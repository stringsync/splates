import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	eventually,
	finish,
	type Held,
	thread,
	working,
} from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";

describe("Conversation steering, as Codex answers it", () => {
	let agent: FakeAgent;
	let conversations: Conversations;
	let conversation: Conversation;
	let held: Held;
	let said: string[];

	beforeEach(async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		agent = new FakeAgent();
		agent.steering = "injected";
		conversations = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer: new FakeTimer(),
				clock: new FakeWallClock(Date.parse("2026-10-11T10:00:00Z")),
				ids: new CounterIdProvider(),
				launch: agent.launch,
			},
		);
		held = {};
		said = [];
		agent.turn = (_client, _session, text) => {
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
		conversation = await working(conversations, held);
	});

	afterEach(() => conversations.disposeAsync());

	it("queues what is said once the turn is on its final answer", async () => {
		// As Codex marks each message for a client that declares AIR.
		await agent.say({
			...say("Done: the tests pass."),
			_meta: { jetbrains: { air: { phase: "final_answer" } } },
		});

		await conversation.prompt("two");

		expect(agent.steered).toEqual([]);
		expect(thread(conversation).at(-1)).toEqual(["two", true]);
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two"]);
		await conversation.prompt("three");
		expect(agent.steered).toEqual(["three"]);
		await finish(conversation, held);
	});

	it("steers no more once the agent starts a turn arbor cannot see end", async () => {
		// As Codex does when its turn ended on the way, whatever arbor asked.
		agent.steering = "startedNewTurn";

		await conversation.prompt("two");
		await conversation.prompt("three");

		expect(agent.steered).toEqual(["two"]);
		expect(thread(conversation).slice(-2)).toEqual([
			["two", false],
			["three", true],
		]);
		await finish(conversation, held);
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "three"]);
		await finish(conversation, held);
	});

	it("queues what the agent failed to steer in, rather than dropping it", async () => {
		agent.steering = "failed";

		await conversation.prompt("two");

		expect(thread(conversation).at(-1)).toEqual(["two", true]);
		held.finish?.("end_turn");
		await eventually(() => said.length === 2);
		expect(said).toEqual(["one", "two"]);
		await finish(conversation, held);
	});
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	eventually,
	finish,
	type Held,
	handled,
	thread,
	working,
} from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";

describe("Conversation following a turn Codex starts for a steer", () => {
	let agent: FakeAgent;
	let conversations: Conversations;
	let conversation: Conversation;
	let held: Held;

	beforeEach(async () => {
		const fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		agent = new FakeAgent();
		agent.steering = "injected";
		agent.lists = true;
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
		agent.turn = () => new Promise((resolve) => (held.finish = resolve));
		conversation = await working(conversations, held);
		// As Codex does when the turn ends just as arbor steers into it.
		agent.steering = "startedNewTurn";
		agent.beforeSteer = async () => {
			held.finish?.("end_turn");
			await handled();
		};
	});

	afterEach(() => conversations.disposeAsync());

	it("declares the session index and subscribes to the list for the conversation's directory", () => {
		expect(agent.capabilities?._meta).toEqual({
			jetbrains: {
				air: { version: 1, capabilities: ["asyncTasks", "sessionIndex"] },
			},
		});
		expect(agent.subscribed).toEqual(["/repo-arbor/login"]);
	});

	it("shows the turn running until the list says it ended", async () => {
		await conversation.prompt("two");
		await handled();

		expect(conversation.state.status).toBe("running");
		expect(conversation.state.taking).toBe("steer");
		expect(thread(conversation).at(-1)).toEqual(["two", false]);

		await agent.list("idle", "2026-10-11T10:00:01Z");
		await eventually(() => conversation.state.status === "idle");
	});

	it("takes a row from before the turn for no end of it", async () => {
		await conversation.prompt("two");
		// Read as the turn before ended, in the second arbor heard of this one.
		await agent.list("idle", "2026-10-11T10:00:00Z");
		await handled();

		expect(conversation.state.status).toBe("running");
	});

	it("ends it on a row saying it stopped, once one said it runs", async () => {
		await conversation.prompt("two");
		await agent.list("running", "2026-10-11T10:00:00Z");
		await handled();
		expect(conversation.state.status).toBe("running");

		await agent.list("error", "2026-10-11T10:00:00Z");
		await eventually(() => conversation.state.status === "idle");
	});

	it("sends what was queued meanwhile once it ends", async () => {
		const said: string[] = [];
		agent.turn = (_client, _session, text) => {
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
		await conversation.prompt("two");
		await agent.say({
			...say("Done."),
			_meta: { jetbrains: { air: { phase: "final_answer" } } },
		});
		await handled();
		await conversation.prompt("three");
		expect(thread(conversation).at(-1)).toEqual(["three", true]);

		await agent.list("idle", "2026-10-11T10:00:01Z");
		await eventually(() => said.length === 1);
		expect(said).toEqual(["three"]);
		await finish(conversation, held);
	});
});

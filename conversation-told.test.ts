import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { eventually, finish, type Held, until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("A conversation told something", () => {
	let fs: FakeFs;
	let held: Held;
	let conversations: Conversations;
	let conversation: Conversation;

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		held = {};
		const agent = new FakeAgent();
		agent.turn = () => new Promise((resolve) => (held.finish = resolve));
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
		conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
	});

	afterEach(() => conversations.disposeAsync());

	it("keeps which conversation said it, in the thread and the log", async () => {
		await conversation.prompt("merge it", [], undefined, { told: "orch" });
		await eventually(() => held.finish !== undefined);
		await finish(conversation, held);
		await conversation.stop();

		expect(conversation.state.messages[0]).toMatchObject({ told: "orch" });
		expect(
			await fs.read(`/repo/.git/arbor/conversations/${conversation.id}.jsonl`),
		).toContain('"told":"orch"');
	});
});

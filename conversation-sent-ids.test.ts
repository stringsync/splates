import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { eventually, finish, type Held, working } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("A conversation's messages the page named", () => {
	const DIR = "/repo/.git/arbor/conversations";
	let fs: FakeFs;
	let held: Held;
	let agent: FakeAgent;
	let conversations: Conversations;

	const deps = () => ({
		fs,
		timer: new FakeTimer(),
		clock: new FakeWallClock(Date.parse("2026-10-17T10:00:00Z")),
		ids: new CounterIdProvider(),
		launch: agent.launch,
	});

	beforeEach(async () => {
		fs = new FakeFs();
		await fs.mkdir("/repo-arbor/login");
		held = {};
		agent = new FakeAgent();
		agent.turn = () => new Promise((resolve) => (held.finish = resolve));
		conversations = new Conversations(DIR, [AGENT], deps());
	});

	afterEach(() => conversations.disposeAsync());

	const ids = (of: Conversation) => of.state.messages.map((each) => each.id);

	// scry-ignore simple-test-setup: only this scenario holds initialization to inspect a prompt queued before startup
	it("keeps the page's id while startup waits and after the queued prompt runs", async () => {
		let ready = () => {};
		agent.hold = new Promise<void>((resolve) => {
			ready = resolve;
		});
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		const prompting = conversation.prompt("first note", [], "phone", {
			id: "p1",
			dictated: true,
		});
		try {
			await eventually(() => conversation.state.messages.length > 0);
			expect(conversation.state.messages).toEqual([
				expect.objectContaining({ id: "p1", queued: true, dictated: true }),
			]);
		} finally {
			ready();
			await prompting;
		}
		expect(conversation.state.messages[0]?.id).toBe("p1");
		expect(conversation.state.messages[0]?.sentAt).toBe(
			"2026-10-17T10:00:00.000Z",
		);
		await eventually(() => held.finish !== undefined);
		await finish(conversation, held);
		await conversation.stop();
		const reread = new Conversations(DIR, [AGENT], deps());
		try {
			const [read] = await reread.list();
			expect(read === undefined ? [] : ids(read)).toEqual(["p1"]);
			expect(read?.state.messages[0]?.sentAt).toBe("2026-10-17T10:00:00.000Z");
		} finally {
			await reread.disposeAsync();
		}
	});

	it("keeps each one's id queued, once sent, and read back from the log", async () => {
		const conversation = await working(conversations, held);
		await conversation.prompt("two", [], undefined, { id: "p2" });
		await conversation.prompt("three", [], undefined, { told: "orch" });

		expect(ids(conversation)).toEqual([undefined, "p2", undefined]);
		expect(conversation.state.messages[1]?.queued).toBe(true);

		await finish(conversation, held);
		await eventually(() => held.finish !== undefined);
		await finish(conversation, held);
		await conversation.stop();

		expect(conversation.state.messages[1]?.queued).toBeUndefined();
		expect(conversation.state.messages[1]?.id).toBe("p2");
		const reread = new Conversations(DIR, [AGENT], deps());
		const [read] = await reread.list();
		expect(read === undefined ? [] : ids(read)).toEqual([
			undefined,
			"p2",
			undefined,
		]);
		await reread.disposeAsync();
	});

	it("keeps the id of one the agent took into its running turn", async () => {
		// Asked when the agent starts, which says whether it can take one.
		agent.steering = "injected";
		const conversation = await working(conversations, held);

		await conversation.prompt("two", [], undefined, { id: "p2" });

		expect(agent.steered).toEqual(["two"]);
		expect(conversation.state.messages[1]).toMatchObject({
			steered: true,
			id: "p2",
		});
		await finish(conversation, held);
	});
});

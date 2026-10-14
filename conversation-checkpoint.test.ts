import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import {
	finish,
	type Held,
	thread,
	until,
	working,
} from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";
import { CHECKPOINT, RESUME } from "./prompts";

describe("Conversation checkpoint", () => {
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

	let _client: acp.AgentSideConnection | undefined;

	beforeEach(() => {
		held = {};
		said = [];
		agent.turn = (connection, _session, text) => {
			_client = connection;
			said.push(text);
			return new Promise((resolve) => (held.finish = resolve));
		};
	});

	it("cancels the turn and says the checkpoint alone, leaving what waited queued", async () => {
		const conversation = await working(conversations, held);
		await conversation.prompt("two");

		const asking = conversation.checkpoint(false);
		for (let i = 0; i < 100 && agent.cancelled === 0; i++) {
			await Bun.sleep(1);
		}
		expect(conversation.state.checkpoint).toBe("asked");
		held.finish?.("cancelled");
		await asking;

		expect(conversation.state.checkpoint).toBe("asked");
		for (let i = 0; i < 100 && said.length < 2; i++) {
			await Bun.sleep(1);
		}
		expect(said).toEqual(["one", CHECKPOINT]);
		await finish(conversation, held);
		expect(conversation.state.checkpoint).toBe("done");
		expect(conversation.state.messages.some((each) => each.stopped)).toBe(
			false,
		);
		expect(thread(conversation)).toEqual([
			["one", false],
			["two", true],
			[CHECKPOINT, false],
		]);
	});

	it("forgets a finished checkpoint once the person says more", async () => {
		const conversation = await started();
		await conversation.checkpoint(false);
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}
		await finish(conversation, held);
		expect(conversation.state.checkpoint).toBe("done");

		await conversation.prompt("carry on");

		expect(conversation.state.checkpoint).toBeNull();
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}
		await finish(conversation, held);
	});

	it("forgets a checkpoint dismissed before the agent answers", async () => {
		const conversation = await started();
		await conversation.checkpoint(false);

		conversation.dismissCheckpoint();
		timer.fireTimeouts();

		expect(conversation.state.checkpoint).toBeNull();
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}
		await finish(conversation, held);
		expect(conversation.state.checkpoint).toBeNull();
	});

	it("lets a merging turn finish, then checkpoints after it", async () => {
		const conversation = await working(conversations, held);

		await conversation.checkpoint(true);

		expect(agent.cancelled).toBe(0);
		expect(conversation.state.checkpoint).toBe("asked");
		held.finish?.("end_turn");
		for (let i = 0; i < 100 && said.length < 2; i++) {
			await Bun.sleep(1);
		}
		expect(said).toEqual(["one", CHECKPOINT]);
		expect(conversation.state.checkpoint).toBe("asked");
		await finish(conversation, held);
		expect(conversation.state.checkpoint).toBe("done");
	});

	it("gives up on an agent that does not answer in time", async () => {
		const conversation = await started();

		await conversation.checkpoint(false);
		timer.fireTimeouts();

		expect(conversation.state.checkpoint).toBe("unanswered");
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}
		await finish(conversation, held);
		expect(conversation.state.checkpoint).toBe("unanswered");
	});

	it("gives up on an agent that does not stop its turn", async () => {
		const conversation = await working(conversations, held);

		const asking = conversation.checkpoint(false);
		for (let i = 0; i < 100 && agent.cancelled === 0; i++) {
			await Bun.sleep(1);
		}
		timer.fireTimeouts();
		await asking;

		expect(conversation.state.checkpoint).toBe("unanswered");
		expect(said).toEqual(["one"]);
		await finish(conversation, held);
	});

	it("keeps where it stands in the log, carrying on after a restart only when told", async () => {
		const conversation = await started();
		await conversation.checkpoint(false);
		for (let i = 0; i < 100 && held.finish === undefined; i++) {
			await Bun.sleep(1);
		}
		await finish(conversation, held);

		await conversation.stop();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();

		expect(read?.state.checkpoint).toBe("done");
		expect(read?.stoppedByCheckpoint).toBe(true);
		await read?.prompt(RESUME);
		expect(read?.state.checkpoint).toBeNull();
		for (let i = 0; i < 100 && said.length < 2; i++) {
			await Bun.sleep(1);
		}
		await finish(read as Conversation, held);
	});

	it("fails when the agent dies before it answers", async () => {
		const conversation = await started();

		await conversation.checkpoint(false);
		agent.crash();
		await until(conversation, "failed");

		expect(conversation.state.checkpoint).toBe("failed");
	});
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("Conversation move", () => {
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

	it("moves into a task's tree and back, and resumes where it was moved to", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();

		conversation.move("signup", "/repo-arbor/signup", "task/auth", "c0");

		expect(conversation.state.task).toBe("signup");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		expect(conversation.state.lastCaller).toBe("c0");
		await conversation.stop();
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-arbor/signup");

		conversation.move(null, "/repo");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.task).toBeNull();
		expect(read?.state.lastTask).toBe("signup");
		expect(read?.state.lastBase).toBe("task/auth");
		expect(read?.state.lastCaller).toBe("c0");
		await read?.prompt("and on");
		await until(read as Conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		await reread.disposeAsync();
	});

	it("resumes in the main tree once its task's worktree is gone", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-arbor/login", { recursive: true });
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch, root: "/repo" },
		);
		const [read] = await reread.list();

		await read?.prompt("go on");
		await until(read as Conversation, "idle");

		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
		expect(read?.state.task).toBeNull();
		expect(read?.state.lastTask).toBe("login");
		await reread.disposeAsync();
	});

	it("says why it cannot resume once its tree is gone and no main tree is known", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-arbor/login", { recursive: true });

		await expect(conversation.prompt("go on")).rejects.toThrow(
			"/repo-arbor/login is gone",
		);
		expect(agent.launched).toHaveLength(1);
	});
});

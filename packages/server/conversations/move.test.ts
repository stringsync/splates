import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { FakeFs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "./index";
import { until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("Conversation move", () => {
	let fs: FakeFs;
	let timer: FakeTimer;
	let clock: FakeWallClock;
	let agent: FakeAgent;
	let conversations: Conversations;

	beforeEach(async () => {
		fs = new FakeFs();
		// The trees the agents run in, which a resume looks for.
		for (const tree of [
			"/repo",
			"/repo-splates/login",
			"/repo-splates/signup",
		]) {
			await fs.mkdir(tree);
		}
		timer = new FakeTimer();
		clock = new FakeWallClock(Date.parse("2026-10-11T10:00:00Z"));
		agent = new FakeAgent();
		conversations = new Conversations(
			"/repo/.git/splates/conversations",
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
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	it("moves into a task's tree and back, and resumes where it was moved to", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();

		conversation.move("signup", "/repo-splates/signup", "task/auth", "c0");

		expect(conversation.state.task).toBe("signup");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		expect(conversation.state.lastCaller).toBe("c0");
		await conversation.stop();
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo-splates/signup");

		conversation.move(null, "/repo");
		expect(conversation.state.lastTask).toBe("signup");
		expect(conversation.state.lastBase).toBe("task/auth");
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/splates/conversations",
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

	it("stops at the end of the turn that left its worktree, and resumes in the main tree", async () => {
		const release = Promise.withResolvers<void>();
		agent.turn = async () => {
			await release.promise;
			return "end_turn";
		};
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await conversation.prompt("merge it");
		await until(conversation, "running");

		conversation.move(null, "/repo");
		release.resolve();
		await until(conversation, "stopped");

		agent.turn = async () => "end_turn";
		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
	});

	it("resumes in the main tree once its task's worktree is gone", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-splates/login", { recursive: true });
		const reread = new Conversations(
			"/repo/.git/splates/conversations",
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

	it("stops immediately when moved off its worktree while idle with nothing awaited", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();

		conversation.move(null, "/repo");
		await until(conversation, "stopped");

		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
	});

	it("waits until an awaited background command's wakeup turn ends before stopping off a deleted worktree", async () => {
		const release = Promise.withResolvers<void>();
		agent.turn = async () => {
			await release.promise;
			return "end_turn";
		};
		const conversation = await started();
		conversation.set({
			wakes: true,
			background: [
				{
					id: "bg-merge",
					name: "splates merge",
					command: "splates merge",
					subagent: null,
					state: "running",
					output: null,
				},
			],
		});

		conversation.move(null, "/repo");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(conversation.state.status).toBe("idle");
		expect(agent.killed).toBe(0);

		const wakeup = conversation.prompt("merged");
		await until(conversation, "running");
		release.resolve();
		await wakeup;
		await until(conversation, "stopped");

		agent.turn = async () => "end_turn";
		await conversation.prompt("next");
		await until(conversation, "idle");
		expect(agent.launched.at(-1)?.cwd).toBe("/repo");
	});

	it("says why it cannot resume once its tree is gone and no main tree is known", async () => {
		agent.turn = async () => "end_turn";
		const conversation = await started();
		await conversation.stop();
		await fs.rm("/repo-splates/login", { recursive: true });

		expect(conversation.prompt("go on")).rejects.toThrow(
			"/repo-splates/login is gone",
		);
		expect(agent.launched).toHaveLength(1);
	});
});

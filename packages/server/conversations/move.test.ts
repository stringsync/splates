import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "core/id";
import { FakeFs, FakePs } from "core/system/testing";
import { FakeTimer, FakeWallClock } from "core/time/testing";
import { FakeAgent, say } from "../agents/testing";
import { LocalWorkerMachine } from "../workers";
import { type Conversation, Conversations } from "./index";
import { once, until } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

class RecordingMachine extends LocalWorkerMachine {
	readonly stopped: { path: string; exclude: readonly number[] }[] = [];

	override async stopUnder(
		path: string,
		exclude: readonly number[] = [],
	): Promise<void> {
		this.stopped.push({ path, exclude });
	}
}

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

	it("sweeps leftover processes after a short wait when leaving a worktree mid-turn, excluding the agent pid, then sweeps again once the turn ends", async () => {
		const machine = new RecordingMachine(new FakePs(), fs);
		const tracked = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				machine,
			},
		);
		const release = Promise.withResolvers<void>();
		agent.pid = 7777;
		agent.turn = async () => {
			await release.promise;
			return "end_turn";
		};
		const conversation = await tracked.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await conversation.prompt("merge it");
		await until(conversation, "running");

		conversation.move(null, "/repo");
		// Does not sweep immediately so the merge command can finish exiting.
		expect(machine.stopped).toEqual([]);

		timer.fireTimeouts();
		expect(machine.stopped).toEqual([
			{ path: "/repo-splates/login", exclude: [7777] },
		]);

		release.resolve();
		await until(conversation, "stopped");
		await Bun.sleep(0);
		expect(machine.stopped).toEqual([
			{ path: "/repo-splates/login", exclude: [7777] },
			{ path: "/repo-splates/login", exclude: [] },
		]);
		await tracked.disposeAsync();
	});

	it("cancels the delayed mid-turn sweep when the turn finishes first, sweeping once after stopping", async () => {
		const machine = new RecordingMachine(new FakePs(), fs);
		const tracked = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				machine,
			},
		);
		const release = Promise.withResolvers<void>();
		agent.pid = 7777;
		agent.turn = async () => {
			await release.promise;
			return "end_turn";
		};
		const conversation = await tracked.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await conversation.prompt("merge it");
		await until(conversation, "running");

		conversation.move(null, "/repo");
		release.resolve();
		await until(conversation, "stopped");
		await Bun.sleep(0);
		timer.fireTimeouts();

		expect(machine.stopped).toEqual([
			{ path: "/repo-splates/login", exclude: [] },
		]);
		await tracked.disposeAsync();
	});

	it("sweeps leftover processes immediately when leaving a worktree while idle or already stopped", async () => {
		const machine = new RecordingMachine(new FakePs(), fs);
		const tracked = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				machine,
			},
		);
		agent.turn = async () => "end_turn";
		const idleConv = await tracked.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(idleConv, "idle");

		idleConv.move(null, "/repo");
		await until(idleConv, "stopped");
		await Bun.sleep(0);
		expect(machine.stopped).toEqual([
			{ path: "/repo-splates/login", exclude: [] },
		]);

		const stoppedConv = await tracked.start("fake", {
			task: "signup",
			cwd: "/repo-splates/signup",
		});
		await until(stoppedConv, "idle");
		await stoppedConv.stop();

		stoppedConv.move(null, "/repo");
		await Bun.sleep(0);
		expect(machine.stopped).toEqual([
			{ path: "/repo-splates/login", exclude: [] },
			{ path: "/repo-splates/signup", exclude: [] },
		]);
		await tracked.disposeAsync();
	});

	it("archives once the merged task's turn ends cleanly when armed with archiveAfterMerge", async () => {
		const release = Promise.withResolvers<void>();
		let turn = 0;
		agent.turn = async (client, sessionId) => {
			turn += 1;
			if (turn === 1) {
				await client.sessionUpdate({
					sessionId,
					update: say("## 📝 Plan: login\n\nImplement login."),
				});
				return "end_turn";
			}
			await release.promise;
			await client.sessionUpdate({
				sessionId,
				update: say("## ✅ Merged login onto main\n\nLogin now works."),
			});
			return "end_turn";
		};
		const conv = await started();
		await conv.prompt("plan it", [], undefined, { person: true });
		await until(conv, "idle");

		const running = conv.prompt("Approve: login", [], undefined, {
			person: true,
			archiveAfterMerge: true,
		});
		await until(conv, "running");
		expect(conv.state.archiveAfterMerge).toBe(true);

		conv.move(null, "/repo", null, null, { merged: true });
		expect(conv.state.archived).toBe(false);

		release.resolve();
		await running;
		await once(conv, () => conv.state.archived);
		expect(conv.state.archived).toBe(true);
		expect(conv.state.archiveAfterMerge).toBeUndefined();
	});

	it("clears archiveAfterMerge without archiving when the turn pauses mid-build", async () => {
		let turn = 0;
		agent.turn = async (client, sessionId) => {
			turn += 1;
			await client.sessionUpdate({
				sessionId,
				update: say(
					turn === 1
						? "## 📝 Plan: pause\n\nDo it."
						: "1. Keep the old flag?\n   - (a) Yes (chosen)\n   - (b) No",
				),
			});
			return "end_turn";
		};
		const paused = await started();
		await paused.prompt("plan it", [], undefined, { person: true });
		await until(paused, "idle");
		await paused.prompt("Approve: pause", [], undefined, {
			person: true,
			archiveAfterMerge: true,
		});
		await until(paused, "idle");
		expect(paused.state.archived).toBe(false);
		expect(paused.state.archiveAfterMerge).toBeUndefined();
	});

	it("clears archiveAfterMerge without archiving on cancel", async () => {
		const release = Promise.withResolvers<void>();
		let turn = 0;
		agent.turn = async (client, sessionId) => {
			turn += 1;
			if (turn === 1) {
				await client.sessionUpdate({
					sessionId,
					update: say("## 📝 Plan: cancel\n\nDo it."),
				});
				return "end_turn";
			}
			await release.promise;
			return "cancelled";
		};
		const cancelled = await started();
		await cancelled.prompt("plan it", [], undefined, { person: true });
		await until(cancelled, "idle");
		await cancelled.prompt("Approve: cancel", [], undefined, {
			person: true,
			archiveAfterMerge: true,
		});
		await until(cancelled, "running");
		const stop = cancelled.cancel();
		release.resolve();
		await stop;
		expect(cancelled.state.archived).toBe(false);
		expect(cancelled.state.archiveAfterMerge).toBeUndefined();
	});

	it("clears archiveAfterMerge without archiving on task removal", async () => {
		const release = Promise.withResolvers<void>();
		let turn = 0;
		agent.turn = async (client, sessionId) => {
			turn += 1;
			if (turn === 1) {
				await client.sessionUpdate({
					sessionId,
					update: say("## 📝 Plan: drop\n\nDo it."),
				});
				return "end_turn";
			}
			await release.promise;
			return "end_turn";
		};
		const removed = await started();
		await removed.prompt("plan it", [], undefined, { person: true });
		await until(removed, "idle");
		await removed.prompt("Approve: drop", [], undefined, {
			person: true,
			archiveAfterMerge: true,
		});
		await until(removed, "running");
		removed.move(null, "/repo", null, null, { merged: false });
		expect(removed.state.archiveAfterMerge).toBeUndefined();
		release.resolve();
		await until(removed, "stopped");
		expect(removed.state.archived).toBe(false);
	});

	it("clears archiveAfterMerge without archiving when the merged reply leaves a card waiting", async () => {
		const release = Promise.withResolvers<void>();
		let turn = 0;
		agent.turn = async (client, sessionId) => {
			turn += 1;
			if (turn === 1) {
				await client.sessionUpdate({
					sessionId,
					update: say("## 📝 Plan: waiting\n\nDo it."),
				});
				return "end_turn";
			}
			await release.promise;
			await client.sessionUpdate({
				sessionId,
				update: say(
					"## ✅ Merged login onto main\n\nMerged.\n\n1. Queue the follow-up?\n   - (a) Yes (chosen)\n   - (b) No",
				),
			});
			return "end_turn";
		};
		const waiting = await started();
		await waiting.prompt("plan it", [], undefined, { person: true });
		await until(waiting, "idle");
		await waiting.prompt("Approve: waiting", [], undefined, {
			person: true,
			archiveAfterMerge: true,
		});
		await until(waiting, "running");
		waiting.move(null, "/repo", null, null, { merged: true });
		release.resolve();
		await until(waiting, "stopped");
		expect(waiting.state.archived).toBe(false);
		expect(waiting.state.archiveAfterMerge).toBeUndefined();
	});
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { Duration } from "webappwiz/time";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { IDLE_STOP } from "./conversation-state";
import { eventually, once, until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent, say } from "./fake-agent";
import { Testing } from "./testing";
import { Watch } from "./watch";

/** What each session is opened with, so Claude asks the arbor way. */
const ASK_IN_ARBOR = {
	claudeCode: { options: { disallowedTools: ["AskUserQuestion"] } },
};

describe("Conversation lifecycle", () => {
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

	it("tells an agent working a task another conversation added which one did", async () => {
		const own = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(own, "idle");
		const handed = await conversations.start("fake", {
			task: "signup",
			cwd: "/repo-arbor/signup",
			caller: own.id,
		});
		await until(handed, "idle");

		expect(agent.launched.map(({ env }) => env.ARBOR_CALLER)).toEqual([
			undefined,
			own.id,
		]);
	});

	it("takes a prompt while still starting, and says it once the session is open", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Hi.") });
			return "end_turn";
		};
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		expect(conversation.state.status).toBe("starting");

		await conversation.prompt("hello");
		await until(conversation, "idle");

		expect(conversation.state.messages).toMatchObject([
			{ role: "user", parts: [{ type: "text", text: "hello" }] },
			{ role: "agent", parts: [{ type: "text", text: "Hi." }] },
		]);
	});

	it("stops the agent, reads back from its log, and resumes on the next prompt", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Done.") });
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("do it");
		await until(conversation, "idle");

		await conversation.stop();

		expect(agent.killed).toBe(1);
		expect(conversation.state.status).toBe("stopped");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state).toMatchObject({
			id: "0",
			agent: "fake",
			task: "login",
			status: "stopped",
			settings: [
				{ id: "mode" },
				{ id: "model", current: "big" },
				{ id: "fast", current: "off" },
			],
			messages: [
				{ role: "user", parts: [{ type: "text", text: "do it" }] },
				{ role: "agent", parts: [{ type: "text", text: "Done." }] },
			],
		});

		await read?.prompt("again");
		await until(read as Conversation, "idle");

		expect(agent.resumed).toEqual(["s1"]);
		expect(agent.opened).toEqual([ASK_IN_ARBOR, ASK_IN_ARBOR]);
		expect(agent.launched.at(-1)?.cwd).toBe(agent.launched[0]?.cwd ?? "");
		expect(read?.state.messages.at(-1)).toMatchObject({
			role: "agent",
			parts: [{ type: "text", text: "Done." }],
		});
		await reread.disposeAsync();
	});

	// scry-ignore simple-test-setup: only this test configures usage and a cumulative session cost
	it("adds up the tokens each turn used and what the session cost, through a restart", async () => {
		agent.usage = {
			inputTokens: 10,
			cachedReadTokens: 900,
			cachedWriteTokens: 90,
			outputTokens: 50,
			totalTokens: 1050,
		};
		let cost = 0;
		agent.turn = async (client, sessionId) => {
			cost += 0.5;
			await client.sessionUpdate({
				sessionId,
				update: {
					sessionUpdate: "usage_update",
					used: 40_000,
					size: 200_000,
					cost: { amount: cost, currency: "USD" },
				},
			});
			return "end_turn";
		};
		const conversation = await started();

		await conversation.prompt("one");
		await until(conversation, "idle");
		await conversation.prompt("two");
		await until(conversation, "idle");
		// Claude counts cost from naught again in a new process.
		await conversation.stop();
		cost = 0;
		await conversation.prompt("three");
		await until(conversation, "idle");

		const usage = {
			context: { used: 40_000, size: 200_000 },
			input: 3000,
			cached: 2700,
			output: 150,
			cost: { amount: 1.5, currency: "USD", said: 0.5 },
			limits: [],
		};
		expect(conversation.state.usage).toEqual(usage);
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state.usage).toEqual(usage);
		await reread.disposeAsync();
	});

	it("keeps a name the person gives over the agent's title, and reads it back", async () => {
		const conversation = await started();

		await conversation.rename("  Login redirect ");

		expect(conversation.state.name).toBe("Login redirect");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		expect((await reread.list())[0]?.state.name).toBe("Login redirect");
		await conversation.rename("");
		expect(conversation.state.name).toBeNull();
	});

	it("is unread once a turn ends until marked read, and reads it back", async () => {
		const conversation = await started();
		expect(conversation.state.unread).toBe(false);

		await conversation.prompt("hello");
		await until(conversation, "idle");

		expect(conversation.state.unread).toBe(true);
		await conversation.markUnread(false);
		expect(conversation.state.unread).toBe(false);
		const reread = () =>
			new Conversations("/repo/.git/arbor/conversations", [AGENT], {
				fs,
				timer,
				clock,
				launch: agent.launch,
			}).list();
		expect((await reread())[0]?.state.unread).toBe(false);
		await conversation.markUnread(true);
		expect((await reread())[0]?.state.unread).toBe(true);
	});

	it("is pinned until unpinned, and reads it back", async () => {
		const conversation = await started();
		expect(conversation.state.pinned).toBe(false);
		const reread = () =>
			new Conversations("/repo/.git/arbor/conversations", [AGENT], {
				fs,
				timer,
				clock,
				launch: agent.launch,
			}).list();

		await conversation.pin(true);

		expect(conversation.state.pinned).toBe(true);
		expect((await reread())[0]?.state.pinned).toBe(true);
		await conversation.pin(false);
		expect((await reread())[0]?.state.pinned).toBe(false);
	});

	it("keeps where the person nested it, and reads it back", async () => {
		const conversation = await started();
		expect(conversation.state.parent).toBeNull();
		const reread = () =>
			new Conversations("/repo/.git/arbor/conversations", [AGENT], {
				fs,
				timer,
				clock,
				launch: agent.launch,
			}).list();

		await conversation.reparent("c9");

		expect(conversation.state.parent).toEqual({ id: "c9" });
		expect((await reread())[0]?.state.parent).toEqual({ id: "c9" });
		await conversation.reparent(null);
		expect((await reread())[0]?.state.parent).toEqual({ id: null });
	});

	it("cuts one moved loose from whoever started it or added its task, and reads it back", async () => {
		const conversation = await conversations.start("fake", {
			task: "signup",
			cwd: "/repo-arbor/signup",
			caller: "c0",
			startedBy: "c0",
		});
		await until(conversation, "idle");
		const reread = async () =>
			(
				await new Conversations("/repo/.git/arbor/conversations", [AGENT], {
					fs,
					timer,
					clock,
					launch: agent.launch,
				}).list()
			)[0]?.state;

		await conversation.reparent(null);
		conversation.move("signup", "/repo-arbor/signup", "main", "c0");

		expect([conversation.state, await reread()]).toEqual([
			expect.objectContaining({ startedBy: null, lastCaller: null }),
			expect.objectContaining({ startedBy: null, lastCaller: null }),
		]);
	});

	it("counts the messages seen when last marked read, and reads it back", async () => {
		const conversation = await started();
		await conversation.prompt("hello");
		await until(conversation, "idle");
		await conversation.markUnread(false);
		const seen = conversation.state.messages.length;
		expect(conversation.state.seen).toBe(seen);

		await conversation.prompt("again");
		await until(conversation, "idle");

		expect(conversation.state.seen).toBe(seen);
		const reread = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();
		expect(reread[0]?.state.seen).toBe(seen);
		expect(reread[0]?.state.messages.length).toBeGreaterThan(seen);
	});

	it("archives by stopping the agent, and is unarchived by a prompt", async () => {
		const conversation = await started();

		await conversation.archive();

		expect(agent.killed).toBe(1);
		expect(conversation.state).toMatchObject({
			status: "stopped",
			archived: true,
		});

		await conversation.prompt("again");

		expect(conversation.state.archived).toBe(false);
		expect(conversation.state.status).not.toBe("stopped");
	});

	it("archives until unarchived, even across a reread", async () => {
		const conversation = await started();

		await conversation.archive();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		expect((await reread.list())[0]?.state.archived).toBe(true);

		await conversation.unarchive();

		expect(conversation.state.archived).toBe(false);
	});

	it("starts one agent at a time, the next once the one before answers", async () => {
		const { promise: up, resolve: answer } = Promise.withResolvers<void>();
		agent.hold = up;
		const one = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		const two = await conversations.start("fake", {
			task: "signup",
			cwd: "/repo-arbor/signup",
		});
		await eventually(() => agent.launched.length !== 0);
		await Bun.sleep(5);

		expect(agent.launched).toHaveLength(1);
		answer();
		await until(one, "idle");
		await until(two, "idle");
		expect(agent.launched).toHaveLength(2);
	});

	it("starts the next agent once the one before dies starting", async () => {
		agent.dying = 1;
		const one = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		const two = await conversations.start("fake", {
			task: "signup",
			cwd: "/repo-arbor/signup",
		});

		await until(one, "failed");
		await until(two, "idle");
		expect(agent.launched).toHaveLength(2);
	});

	it("says what the agent wrote to stderr when it died starting", async () => {
		agent.dying = 1;
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "failed");
		expect(conversation.state.error).toBe("fake agent fell over");
	});

	it("opens a new session for one whose agent died before opening its own", async () => {
		agent.dying = 1;
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "failed");
		expect(conversation.sessionId).toBeNull();

		await conversation.prompt("again");
		await until(conversation, "idle");

		expect(conversation.sessionId).toBe("s1");
		expect(agent.resumed).toEqual([]);
		expect(agent.opened).toEqual([ASK_IN_ARBOR]);
	});

	/** Fires each pending wait as long as an agent may sit idle. */
	const restOut = () => {
		for (const entry of timer.timeouts) {
			if (!entry.disposed && entry.delay.ms === IDLE_STOP.ms) {
				entry.disposed = true;
				entry.callback();
			}
		}
	};

	it("stops an agent left idle, and resumes its session on the next prompt", async () => {
		const conversation = await started();

		restOut();
		await once(conversation, () => conversation.state.stoppedIdle !== null);
		expect(conversation.state.status).toBe("stopped");
		expect(conversation.state.stoppedIdle).toBe("2026-10-11T10:00:00.000Z");
		expect(agent.killed).toBe(1);

		await conversation.prompt("again");
		await until(conversation, "idle");
		expect(agent.launched).toHaveLength(2);
		expect(agent.resumed).toHaveLength(1);
		expect(conversation.state.stoppedIdle).toBeNull();
	});

	it("leaves an agent be while its turn runs", async () => {
		let finish = () => {};
		agent.turn = () =>
			new Promise((resolve) => {
				finish = () => resolve("end_turn");
			});
		const conversation = await started();
		const prompted = conversation.prompt("work");
		await until(conversation, "running");

		restOut();
		expect(conversation.state.status).toBe("running");
		finish();
		await prompted;
		expect(agent.killed).toBe(0);
	});

	it("leaves an agent be while a command it left in the background runs", async () => {
		const conversation = await started();
		const running = {
			id: "b1",
			name: "dev server",
			command: "bun dev",
			subagent: null,
			state: "running",
			output: null,
		} as const;
		conversation.set({ background: [running] });

		restOut();
		expect(conversation.state.status).toBe("idle");

		conversation.set({ background: [{ ...running, state: "completed" }] });
		restOut();
		await until(conversation, "stopped");
	});

	it("fails with the agent's last words when it dies on its own", async () => {
		const conversation = await started();

		agent.crash();
		await until(conversation, "failed");

		expect(conversation.state.error).toBe("fake agent fell over");
	});

	it("stamps what is said with when, and reads the times back from the log", async () => {
		agent.turn = async (client, sessionId) => {
			clock.advance(Duration.secs(3));
			await client.sessionUpdate({ sessionId, update: say("Done.") });
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("go");
		await until(conversation, "idle");
		await conversation.stop();

		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(
			read?.state.messages.map(({ at, until }) => ({ at, until })),
		).toEqual([
			{ at: "2026-10-11T10:00:00.000Z", until: "2026-10-11T10:00:00.000Z" },
			{ at: "2026-10-11T10:00:03.000Z", until: "2026-10-11T10:00:03.000Z" },
		]);
		await reread.disposeAsync();
	});

	it("saves a streaming log at most once per interval, and all of it on stop", async () => {
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("a") });
			await client.sessionUpdate({ sessionId, update: say("b") });
			await client.sessionUpdate({ sessionId, update: say("c") });
			return "end_turn";
		};
		const conversation = await started();
		await conversation.prompt("go");
		await until(conversation, "idle");
		const log = "/repo/.git/arbor/conversations/0.jsonl";
		await Bun.sleep(1);

		// The prompt is durable before sending; the first streamed update
		// starts the next interval and the remaining chunks wait for it.
		expect(
			(await fs.read(log))
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line).kind),
		).toEqual(["start", "session", "settings", "prompt", "turn", "update"]);
		await conversation.stop();
		const lines = (await fs.read(log)).trim().split("\n");
		expect(lines.map((line) => JSON.parse(line).kind)).toEqual([
			"start",
			"session",
			"settings",
			"prompt",
			"turn",
			"update",
			"update",
			"update",
			"turn",
			"unread",
			"end",
		]);
	});

	// scry-ignore simple-test-setup: only this test needs a real repository and a git command watcher
	it("flags a command for what it did to git, and keeps the flag in the log", async () => {
		await using env = await Testing.open();
		await env.fs.write(join(env.root, "README.md"), "edited\n");
		// the command waits for the look before it, which a loaded machine slows
		const looked = Promise.withResolvers<void>();
		const watch = new (class extends Watch {
			override command(cwd: string) {
				const watched = super.command(cwd);
				void watched.looked().then(looked.resolve);
				return watched;
			}
		})(env.git);
		const watching = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch, watch },
		);
		const command = (id: string, status: "in_progress" | "completed") =>
			({
				sessionUpdate:
					id === "t1" && status === "in_progress"
						? "tool_call"
						: "tool_call_update",
				toolCallId: id,
				title: "git stash",
				kind: "execute",
				status,
			}) as acp.SessionUpdate;
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({
				sessionId,
				update: command("t1", "in_progress"),
			});
			await looked.promise;
			await env.gitCli(env.root, "stash");
			await client.sessionUpdate({
				sessionId,
				update: command("t1", "completed"),
			});
			return "end_turn";
		};
		const conversation = await watching.start("fake", {
			task: null,
			cwd: env.root,
		});
		await until(conversation, "idle");

		await conversation.prompt("stash it");
		await until(conversation, "idle");
		const flagged = async (each: Conversation) => {
			const part = () => each.state.messages[1]?.parts[0];
			await once(each, () => {
				const tool = part();
				return tool?.type === "tool" && tool.flags.length > 0;
			});
			return part();
		};

		expect(await flagged(conversation)).toMatchObject({
			flags: [{ type: "stashed", count: 1 }],
		});
		await conversation.stop();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		).list();
		expect(await flagged(read as Conversation)).toMatchObject({
			flags: [{ type: "stashed", count: 1 }],
		});
		await watching.disposeAsync();
	});
});

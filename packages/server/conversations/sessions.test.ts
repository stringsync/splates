import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { AGENT, FakeAgent, heard, printed, say } from "../agents/testing";
import { type Conversation, Conversations, launch } from "./index";
import { until } from "./testing";

/** What each session is opened with, so Claude asks the splates way. */
const ASK_IN_SPLATES = {
	claudeCode: { options: { disallowedTools: ["AskUserQuestion"] } },
};

describe("Conversation sessions", () => {
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

	const _started = async () => {
		const conversation = await conversations.start("fake", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");
		return conversation;
	};

	beforeEach(() => {
		agent.held = [
			{
				sessionId: "cli-1",
				cwd: "/repo-splates/login",
				title: "Fix login",
				updatedAt: "2026-10-11T09:00:00Z",
				replay: [
					heard("fix the "),
					heard("login"),
					say("Fixed."),
					heard("thanks"),
					say("Welcome."),
				],
			},
			{
				sessionId: "cli-2",
				cwd: "/repo-splates/login",
				updatedAt: "2026-10-11T09:30:00Z",
				replay: [],
			},
			{
				sessionId: "cli-3",
				cwd: "/repo-splates/other",
				replay: [],
			},
		];
	});

	it("lists each agent's sessions in the tree, newest first, from a process that stops", async () => {
		const sessions = await conversations.sessions("/repo-splates/login");

		expect(sessions).toEqual([
			{
				agent: "fake",
				session: "cli-2",
				title: null,
				updatedAt: "2026-10-11T09:30:00Z",
			},
			{
				agent: "fake",
				session: "cli-1",
				title: "Fix login",
				updatedAt: "2026-10-11T09:00:00Z",
			},
		]);
		expect(agent.launched).toEqual([
			{ argv: ["fake-acp"], cwd: "/repo-splates/login", env: {} },
		]);
		expect(agent.killed).toBe(1);
	});

	it("lists none from an agent that cannot list and load them", async () => {
		agent.held = null;

		expect(await conversations.sessions("/repo-splates/login")).toEqual([]);
	});

	it("loads one into a log of its own, replayed, and resumes it after", async () => {
		const conversation = await conversations.bring("fake", "cli-1", {
			task: "login",
			cwd: "/repo-splates/login",
			title: "Fix login",
		});
		await until(conversation, "idle");

		expect(agent.loaded).toEqual(["cli-1"]);
		expect(agent.opened).toEqual([ASK_IN_SPLATES]);
		expect(conversation.state).toMatchObject({
			task: "login",
			title: "Fix login",
			messages: [
				{ role: "user", parts: [{ type: "text", text: "fix the login" }] },
				{ role: "agent", parts: [{ type: "text", text: "Fixed." }] },
				{ role: "user", parts: [{ type: "text", text: "thanks" }] },
				{ role: "agent", parts: [{ type: "text", text: "Welcome." }] },
			],
		});
		expect(
			(await conversations.sessions("/repo-splates/login")).map(
				(each) => each.session,
			),
		).toEqual(["cli-2"]);

		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/splates/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		expect(read?.state).toMatchObject({
			title: "Fix login",
			messages: conversation.state.messages,
		});
		await read?.prompt("again");
		await until(read as Conversation, "idle");
		expect(agent.resumed).toEqual(["cli-1"]);
		expect(agent.loaded).toEqual(["cli-1"]);
		await reread.disposeAsync();
	});

	it("refuses a session a conversation already holds", async () => {
		const conversation = await conversations.bring("fake", "cli-1", {
			task: "login",
			cwd: "/repo-splates/login",
		});
		await until(conversation, "idle");

		await expect(
			conversations.bring("fake", "cli-1", {
				task: "login",
				cwd: "/repo-splates/login",
			}),
		).rejects.toMatchObject({ reason: "usage" });
	});

	it("reports a missing executable without opening a protocol session", async () => {
		const agent = launch(["/nonexistent/splates-opencode-fixture"], "/tmp", {});
		expect(await agent.exited).toBe(127);
		expect(agent.stderr()).toContain(
			"cannot start /nonexistent/splates-opencode-fixture",
		);
		await expect(printed(agent)).rejects.toThrow();
	});

	it("ends an agent that cannot start as one that exited saying why", async () => {
		const agent = launch(["sh"], "/no/such/tree", {});

		expect(await agent.exited).toBe(127);
		expect(agent.stderr()).toStartWith("cannot start sh in /no/such/tree: ");
		expect(printed(agent)).rejects.toThrow();
	});
});

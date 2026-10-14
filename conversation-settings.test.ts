import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { until } from "./conversation-testing";
import { type Conversation, Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";

describe("Conversation settings", () => {
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

	it("sets the settings picked up front once the session is open, skipping what it already is", async () => {
		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
			settings: { model: "small", mode: "ask", size: "huge" },
		});
		await until(conversation, "idle");

		expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
		expect(
			conversation.state.settings.map((each) => [each.id, each.current]),
		).toEqual([
			["mode", "ask"],
			["model", "small"],
			["fast", "off"],
		]);
	});

	it("sets an on/off setting as a boolean, picked up front or switched", async () => {
		const conversation = await conversations.start("fake", {
			task: null,
			cwd: "/repo",
			settings: { fast: "on" },
		});
		await until(conversation, "idle");
		await conversation.choose("fast", "off");

		expect(agent.chosen).toEqual([
			{ configId: "fast", value: true },
			{ configId: "fast", value: false },
		]);
		expect(
			conversation.state.settings.find((each) => each.id === "fast")?.current,
		).toBe("off");
	});

	it("switches a setting to a value the agent offers, and refuses any other", async () => {
		const conversation = await started();

		await conversation.choose("model", "small");
		expect(
			conversation.state.settings.find((each) => each.id === "model")?.current,
		).toBe("small");
		await expect(conversation.choose("model", "huge")).rejects.toThrow(
			"'huge' is not a model this agent offers",
		);
		await expect(conversation.choose("size", "huge")).rejects.toThrow(
			"has no setting 'size'",
		);
	});

	it("takes a setting while stopped, and sets it as the session resumes", async () => {
		const conversation = await started();
		await conversation.stop();

		await conversation.choose("model", "small");
		expect(
			conversation.state.settings.find((each) => each.id === "model")?.current,
		).toBe("small");
		expect(agent.chosen).toEqual([]);

		await conversation.prompt("go on");
		await until(conversation, "idle");
		expect(agent.chosen).toEqual([{ configId: "model", value: "small" }]);
	});

	it("keeps a setting picked while stopped across a restart", async () => {
		const conversation = await started();
		await conversation.stop();
		await conversation.choose("mode", "auto");
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, clock, launch: agent.launch },
		);
		const [read] = await reread.list();
		// A new agent process: what it starts with is its own default.
		agent.chosen = [];

		await read?.prompt("go on");
		await until(read as Conversation, "idle");
		expect(agent.chosen).toEqual([{ configId: "mode", value: "auto" }]);
		await reread.disposeAsync();
	});
});

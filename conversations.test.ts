import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { FakeFs } from "webappwiz/system/testing";
import { FakeTimer, FakeWallClock } from "webappwiz/time/testing";
import { Adherence } from "./adherence";
import { eventually, until } from "./conversation-testing";
import { Conversations } from "./conversations";
import { AGENT, FakeAgent } from "./fake-agent";
import { Limits } from "./limits";
import { Offered } from "./offered";
import type { Outcome } from "./outcomes";
import { Outcomes } from "./outcomes";

/** What each session is opened with, so Claude asks the arbor way. */
const ASK_IN_ARBOR = {
	claudeCode: { options: { disallowedTools: ["AskUserQuestion"] } },
};

describe("Conversations", () => {
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

	it("starts the agent in the task's tree and offers its settings", async () => {
		const conversation = await started();

		expect(agent.launched).toEqual([
			{
				argv: ["fake-acp"],
				cwd: "/repo-arbor/login",
				env: { ARBOR_CONVERSATION: "0" },
			},
		]);
		expect(conversation.state).toMatchObject({
			agent: "fake",
			task: "login",
			settings: [
				{ id: "mode", category: "mode", current: "ask" },
				{
					id: "model",
					name: "Model",
					category: "model",
					current: "big",
					options: [
						{ value: "big", name: "Big", description: null },
						{ value: "small", name: "Small", description: "Fast" },
					],
				},
				{
					id: "fast",
					name: "Fast mode",
					type: "boolean",
					current: "off",
					options: [
						{ value: "on", name: "On", description: null },
						{ value: "off", name: "Off", description: null },
					],
				},
			],
		});
	});

	it("turns Claude's AskUserQuestion off, so it asks under ## Blocked instead", async () => {
		await started();

		expect(agent.opened).toEqual([ASK_IN_ARBOR]);
	});

	it("remembers what an agent's sessions offer for every project, as last left", async () => {
		const offered = new Offered("/home/.arbor/offered.json", { fs });
		const project = (dir: string) =>
			new Conversations(dir, [AGENT], {
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				offered,
			});
		const shop = project("/shop/.git/arbor/conversations");
		const conversation = await shop.start("fake", { task: null, cwd: "/shop" });
		await until(conversation, "idle");
		await conversation.choose("model", "small");
		await shop.disposeAsync();

		// Another project, and another process, as after a restart.
		const blog = project("/blog/.git/arbor/conversations");
		const later = new Offered(offered.path, { fs });
		expect(await blog.settings()).toEqual(await later.all());
		const settings = (await later.all()).fake ?? [];
		expect(settings.map((each) => [each.id, each.current])).toEqual([
			["mode", "ask"],
			["model", "small"],
			["fast", "off"],
		]);

		// A log read back, older than what was offered since, changes nothing.
		await offered.remember("fake", []);
		await project("/shop/.git/arbor/conversations").list();
		expect((await offered.all()).fake).toEqual([]);
	});

	it("leaves what an agent's sessions offer as the person left it when a todo assigned the model", async () => {
		const offered = new Offered("/home/.arbor/offered.json", { fs });
		const shop = new Conversations("/shop/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			offered,
		});
		const currents = async () => {
			// Remembered as each change lands, without waiting on it.
			await Bun.sleep(10);
			return ((await offered.all()).fake ?? []).map((each) => [
				each.id,
				each.current,
			]);
		};

		// With nothing kept yet, an assigned one says what the agent offers.
		const first = await shop.start("fake", {
			task: null,
			cwd: "/shop",
			model: "small",
			assigned: true,
		});
		await until(first, "idle");
		expect(await currents()).toContainEqual(["model", "small"]);

		const picked = await shop.start("fake", { task: null, cwd: "/shop" });
		await until(picked, "idle");
		await picked.choose("model", "big");
		const assigned = await shop.start("fake", {
			task: null,
			cwd: "/shop",
			model: "small",
			assigned: true,
		});
		await until(assigned, "idle");
		expect(await currents()).toContainEqual(["model", "big"]);
		expect([picked.state.assigned, assigned.state.assigned]).toEqual([
			false,
			true,
		]);
		await shop.disposeAsync();

		// Read back from its log, as after a restart.
		const later = new Conversations("/shop/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
		});
		expect((await later.find(assigned.id)).state.assigned).toBe(true);
		await later.disposeAsync();
	});

	it("keeps the project's arbor skill version from the start, past a restart", async () => {
		await fs.write(
			"/repo/.agents/skills/arbor/SKILL.md",
			"---\nname: arbor\nversion: 0.0.43\n---\n\n# Using arbor\n",
		);
		const shop = new Conversations("/repo/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			root: "/repo",
		});
		const conversation = await shop.start("fake", {
			task: "login",
			cwd: "/repo-arbor/login",
		});
		await until(conversation, "idle");
		await shop.disposeAsync();
		// A later release does not change what it started on.
		await fs.write(
			"/repo/.agents/skills/arbor/SKILL.md",
			"---\nversion: 0.0.44\n---\n",
		);

		const later = new Conversations("/repo/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
		});
		expect(conversation.state.skill).toBe("0.0.43");
		expect((await later.find(conversation.id)).state.skill).toBe("0.0.43");
		await later.disposeAsync();
	});

	it("judges how a conversation follows the skill as each turn ends", async () => {
		const adherence = new Adherence("/home/.arbor/adherence.jsonl", fs, null);
		const shop = new Conversations("/repo/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			adherence,
		});
		const conversation = await shop.start("fake", { task: null, cwd: "/repo" });
		await until(conversation, "idle");
		await conversation.prompt("hello");
		await until(conversation, "idle");
		// Judged as the turn ends, without waiting on it.
		await Bun.sleep(10);

		expect(await adherence.list()).toMatchObject([
			{ conversation: conversation.id, project: "/repo", skill: null },
		]);
		await shop.disposeAsync();
	});

	it("credits a task merged mid-turn with that turn's usage once it ends", async () => {
		const outcomes = new Outcomes("/home/.arbor/outcomes.jsonl", fs);
		const shop = new Conversations("/repo/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			outcomes,
		});
		const conversation = await shop.start("fake", { task: null, cwd: "/repo" });
		await until(conversation, "idle");
		agent.usage = { inputTokens: 40, outputTokens: 7, totalTokens: 47 };
		agent.turn = async () => {
			// As `arbor merge` writes it, before the turn says its usage.
			await outcomes.record({
				...MERGED,
				conversation: conversation.id,
				startedAt: conversation.now(),
				endedAt: conversation.now(),
			});
			return "end_turn";
		};
		await conversation.prompt("merge it");
		await until(conversation, "idle");
		// Credited as the turn ends, without waiting on it.
		await eventually(
			async () => (await outcomes.list())[0]?.usage !== undefined,
		);

		expect((await outcomes.list())[0]?.usage).toEqual({
			input: 40,
			cached: 0,
			output: 7,
			cost: null,
		});
		await shop.disposeAsync();
	});

	it("remembers an agent's plan limits for every project, the newest of each window", async () => {
		const limits = new Limits("/home/.arbor/limits.json", { fs });
		agent.turn = async (connection) => {
			await connection.sessionUpdate({
				sessionId: "s1",
				update: {
					sessionUpdate: "usage_update",
					used: 1,
					size: 10,
					_meta: {
						"_claude/rateLimit": {
							status: "allowed",
							unifiedWindows: {
								five_hour: { utilization: 0.42, resetsAt: 1_791_730_800 },
								seven_day: { utilization: 0.18, resetsAt: 1_792_000_000 },
							},
						},
					},
				},
			});
			return "end_turn";
		};
		const shop = new Conversations("/shop/.git/arbor/conversations", [AGENT], {
			fs,
			timer,
			clock,
			ids: new CounterIdProvider(),
			launch: agent.launch,
			limits,
		});
		const conversation = await shop.start("fake", { task: null, cwd: "/shop" });
		await until(conversation, "idle");
		await conversation.prompt("one");
		await until(conversation, "idle");
		await shop.disposeAsync();

		// Another project, and another process, as after a restart.
		const later = new Limits(limits.path, { fs });
		const blog = new Conversations("/blog/.git/arbor/conversations", [AGENT], {
			fs,
			limits: later,
		});
		expect(await blog.limits()).toEqual({
			fake: [
				{
					window: "five_hour",
					used: 0.42,
					resets: "2026-10-11T15:00:00.000Z",
					at: "2026-10-11T10:00:00.000Z",
				},
				{
					window: "seven_day",
					used: 0.18,
					resets: "2026-10-14T17:46:40.000Z",
					at: "2026-10-11T10:00:00.000Z",
				},
			],
		});

		// What is older than what is known of a window changes nothing.
		await later.remember("fake", [
			{
				window: "five_hour",
				used: 0.9,
				resets: "2026-10-11T15:00:00.000Z",
				at: "2026-10-11T09:00:00.000Z",
			},
		]);
		expect((await later.all()).fake?.[0]?.used).toBe(0.42);
	});

	it("asks an agent that does not send its plan limits for them after each turn, and keeps them in the log", async () => {
		const asked: string[] = [];
		const window = {
			window: "43200_minutes",
			used: 0.07,
			resets: "2026-11-08T13:47:41.000Z",
			at: "2026-10-11T10:00:00.000Z",
		};
		const asking = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{
				fs,
				timer,
				clock,
				ids: new CounterIdProvider(),
				launch: agent.launch,
				readLimits: async (each) => {
					asked.push(each.id);
					return [window];
				},
			},
		);
		const conversation = await asking.start("fake", {
			task: null,
			cwd: "/repo",
		});
		await until(conversation, "idle");
		expect(asked).toEqual([]);

		await conversation.prompt("one");
		await until(conversation, "idle");
		await eventually(() => conversation.state.usage.limits.length > 0);

		expect(asked).toEqual(["fake"]);
		expect(conversation.state.usage.limits).toEqual([window]);
		await asking.disposeAsync();
		const [read] = await new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		).list();
		expect(read?.state.usage.limits).toEqual([window]);
	});

	it("refuses an agent it does not know", async () => {
		await expect(
			conversations.start("nobody", { task: null, cwd: "/repo" }),
		).rejects.toThrow("no agent 'nobody': use one of fake");
	});

	it("finds one while another caller is still reading them back", async () => {
		const conversation = await started();
		await conversation.stop();
		const reread = new Conversations(
			"/repo/.git/arbor/conversations",
			[AGENT],
			{ fs, timer, launch: agent.launch },
		);

		// As a page listing a project just opened while it prompts one.
		const [listed, found] = await Promise.all([
			reread.list(),
			reread.find(conversation.id),
		]);

		expect(found.id).toBe(conversation.id);
		expect(listed.map((each) => each.id)).toEqual([conversation.id]);
		await reread.disposeAsync();
	});
});

/** A task merged with no usage of its own, as one done in a single turn. */
const MERGED: Outcome = {
	project: "/repo",
	task: "login",
	base: "main",
	ended: "merged",
	startedAt: "",
	endedAt: "",
	questionRounds: 0,
	reviewRounds: 0,
	failedMerges: 0,
	usage: { input: 0, cached: 0, output: 0, cost: null },
	conversation: null,
	agent: null,
	model: null,
};

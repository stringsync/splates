import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "../conversations";
import { until } from "../conversations/testing";
import type { RosterAgent } from "../models";
import { Testing } from "../testing";
import { startAutoPick } from "./index";
import { lifting } from "./lift";
import { FakeJudge } from "./testing";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

const ROSTERED = {
	id: "fake",
	name: "Fake",
	argv: ["fake-acp"],
	models: [
		{ id: "big", name: "Big", strengths: "hard problems", cost: "high" },
		{ id: "small", name: "Small", strengths: "quick edits", cost: "low" },
	],
};

describe("lifting", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let judge: FakeJudge;
	/** The model the agent was on as each prompt reached it. */
	let on: string[];
	/** What the agent answers each prompt, in turn; nothing once they run out. */
	let answers: string[];

	const start = async (words = "Rename foo\nIn src only.") => {
		const conversation = await startAutoPick({
			project: deps,
			conversations,
			target: { words },
			judge: async () => judge,
			start: (picked, { model, settings, picking }) =>
				conversations.start(picked, {
					task: null,
					cwd: deps.root,
					model,
					settings,
					assigned: true,
					picking,
				}),
		});
		await until(conversation, "idle");
		await conversation.prompt(words);
		await until(conversation, "idle");
		return conversation;
	};
	const say = async (conversation: Conversation, words: string) => {
		await conversation.prompt(words);
		await until(conversation, "idle");
	};
	/** A conversation the person started on Big, their own pick, then said `words` to. */
	const own = async (words = "Look at the failing build.") => {
		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.root,
			model: "big",
			assigned: false,
		});
		await until(conversation, "idle");
		await say(conversation, words);
		return conversation;
	};
	const autoLines = async () =>
		(await deps.journal.tail(20)).filter((each) => each.action === "auto");

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		on = [];
		answers = [];
		agent.turn = async (client, sessionId) => {
			on.push(
				String(agent.options.find((each) => each.id === "model")?.currentValue),
			);
			const text = answers.shift();
			if (text !== undefined) {
				await client.sessionUpdate({
					sessionId,
					update: {
						sessionUpdate: "agent_message_chunk",
						content: { type: "text", text },
					},
				});
			}
			return "end_turn";
		};
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		judge = new FakeJudge(LIGHT_EDIT);
		conversations.lift = lifting(deps, conversations, {
			judge: async () => judge,
		});
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({
				agents: [RANKED],
			}),
		);
		await deps.fs.write(
			`${deps.splatesHome}/auto-pick.json`,
			JSON.stringify({
				format: 2,
				threshold: 0.5,
				rules: [
					{
						kind: "bugfix",
						depth: "shallow",
						picks: [{ agent: "fake", model: "small" }],
					},
					{
						kind: "*",
						depth: "*",
						picks: [{ agent: "fake", model: "big" }],
					},
				],
			}),
		);
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("moves the conversation up before the agent reads a message that widens it", async () => {
		const conversation = await start();
		expect(on).toEqual(["small"]);

		judge = new FakeJudge(WIDE);
		await say(conversation, WIDENING);

		expect(on).toEqual(["small", "big"]);
		expect(judge.asked[0]?.state).toMatchObject({
			subject: WIDENING,
		});
		expect(conversation.state.autoPick).toMatchObject({
			rule: 1,
			model: "big",
			kind: "open",
			depth: "deep",
			overridden: false,
		});
		expect((await autoLines()).at(-1)).toMatchObject({
			conversation: conversation.id,
			model: "big",
			lifted: { from: "Small", undo: { model: "small" } },
		});
	});

	it("moves nothing for a message the judge finds no bigger", async () => {
		const conversation = await start();
		const asked = judge.asked.length;
		await say(conversation, "Also rename baz to qux, in the same file please.");

		expect(judge.asked.length).toBeGreaterThan(asked);
		expect(on).toEqual(["small", "small"]);
		expect(await autoLines()).toHaveLength(1);
	});

	it("asks the judge nothing of a short message", async () => {
		const conversation = await start();
		judge = new FakeJudge(WIDE);
		await say(conversation, "go");

		expect(judge.asked).toEqual([]);
		expect(on).toEqual(["small", "small"]);
	});

	it("keeps Auto pick on when the person moves the model", async () => {
		const conversation = await start();
		await conversation.choose("model", "small");

		expect(conversation.state.autoPick?.overridden).toBe(false);
	});

	it("moves the conversation up for the answer to a first reply that asked back", async () => {
		answers = ["I can rename it in src or everywhere. Which do you want?\n"];
		const conversation = await start();
		judge = new FakeJudge(WIDE);
		await say(conversation, "src");

		expect(judge.asked).toEqual([]);
		expect(on).toEqual(["small", "big"]);
		expect(conversation.state.autoPick).toMatchObject({
			model: "big",
			kind: "bugfix",
			depth: "moderate",
		});
		const line = (await autoLines()).at(-1);
		expect(line).toMatchObject({
			model: "big",
			lifted: { from: "Small", undo: { model: "small" } },
		});
		expect(line?.reasons).toContain("its first answer asked back, so moderate");
	});

	it("moves nothing for the answer to a first reply that ended otherwise", async () => {
		answers = ["Renamed foo to bar in src."];
		const conversation = await start();
		await say(conversation, "thanks");

		expect(on).toEqual(["small", "small"]);
		expect(await autoLines()).toHaveLength(1);
	});

	it("looks only at the first reply, not a question asked later", async () => {
		answers = ["Renamed foo to bar in src.", "Anything else?"];
		const conversation = await start();
		await say(conversation, "thanks");
		await say(conversation, "no");

		expect(on).toEqual(["small", "small", "small"]);
	});

	it("keeps the move and Auto pick's switch across a restart", async () => {
		const conversation = await start();
		judge = new FakeJudge(WIDE);
		await say(conversation, WIDENING);
		await conversation.choose("model", "small");
		await conversations.disposeAsync();

		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		const back = await conversations.find(conversation.id);
		expect(back.state.autoPick).toMatchObject({
			model: "big",
			overridden: false,
		});
	});

	it("switched on by the person, moves to the rules' pick for all they said, down too, with an Undo", async () => {
		const conversation = await own();
		conversation.switchAutoPick(true);
		expect(conversation.state.autoPick).toMatchObject({
			agent: AGENT.id,
			overridden: false,
			rejudge: true,
		});

		await say(conversation, "go");

		expect(on).toEqual(["big", "small"]);
		expect(judge.asked[0]?.state).toMatchObject({
			subject: "Look at the failing build.",
		});
		expect(conversation.state.autoPick).toMatchObject({
			rule: 0,
			model: "small",
			overridden: false,
		});
		expect(conversation.state.autoPick?.rejudge).toBeUndefined();
		expect((await autoLines()).at(-1)).toMatchObject({
			model: "small",
			lifted: { from: "Big", undo: { model: "big" }, switched: true },
		});
	});

	it("switched on, stays on a pick the rules agree with, saying so without an Undo", async () => {
		judge = new FakeJudge(WIDE);
		const conversation = await own();
		conversation.switchAutoPick(true);
		await say(conversation, "go");

		expect(on).toEqual(["big", "big"]);
		expect(conversation.state.autoPick).toMatchObject({ model: "big" });
		expect(conversation.state.autoPick?.rejudge).toBeUndefined();
		expect((await autoLines()).at(-1)).toMatchObject({
			model: "big",
			lifted: null,
		});
	});

	it("switched on, only moves up after its first look", async () => {
		judge = new FakeJudge(WIDE);
		const conversation = await own();
		conversation.switchAutoPick(true);
		await say(conversation, "go");
		judge = new FakeJudge(LIGHT_EDIT);
		await say(conversation, "Also rename baz to qux, in the same file please.");

		expect(on).toEqual(["big", "big", "big"]);
	});

	it("switched on, looks again at the next message when the judge said nothing", async () => {
		conversations.lift = lifting(deps, conversations, {
			judge: async () => null,
		});
		const conversation = await own();
		conversation.switchAutoPick(true);
		await say(conversation, "go");

		expect(on).toEqual(["big", "big"]);
		expect(conversation.state.autoPick?.rejudge).toBe(true);
	});

	it("switched on, stays on when the person picks a model, across a restart too", async () => {
		const conversation = await own();
		conversation.switchAutoPick(true);
		await conversation.choose("model", "big");
		expect(conversation.state.autoPick?.overridden).toBe(false);
		await conversations.disposeAsync();

		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		const back = await conversations.find(conversation.id);
		expect(back.state.autoPick?.overridden).toBe(false);
	});

	it("switches off and on again, judging afresh", async () => {
		const conversation = await start();
		conversation.switchAutoPick(false);
		expect(conversation.state.autoPick).toMatchObject({
			model: "small",
			overridden: true,
		});
		judge = new FakeJudge(WIDE);
		await say(conversation, WIDENING);
		expect(on).toEqual(["small", "small"]);

		conversation.switchAutoPick(true);
		expect(conversation.state.autoPick).toMatchObject({
			model: "small",
			overridden: false,
			rejudge: true,
		});
		await say(conversation, "go");
		expect(on).toEqual(["small", "small", "big"]);
	});
});

/** A judge sure the task is easy mechanical work. */
const LIGHT_EDIT = {
	"kind:bugfix": 0.9,
	"kind:open": 0.1,
	"depth:shallow": 0.8,
	"depth:deep": 0.1,
};

/** A judge sure the work is open-ended and deep. */
const WIDE = {
	"kind:bugfix": 0.1,
	"kind:open": 0.9,
	"depth:shallow": 0.1,
	"depth:deep": 0.8,
};

const WIDENING =
	"Let's take this a different direction: propose a few variants.";

/** The fake agent, its models ranked: Big above Small. */
const RANKED: RosterAgent = {
	...ROSTERED,
	models: [
		{
			id: "big",
			name: "Big",
			strengths: "",
			cost: "high",
			tier: 4,
			speed: "medium",
			costRank: 2,
		},
		{
			id: "small",
			name: "Small",
			strengths: "",
			cost: "low",
			tier: 1,
			speed: "fast",
			costRank: 1,
		},
	],
};

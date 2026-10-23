import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { FakeAgent, say as saying } from "../agents/testing";
import type { Judge } from "../auto-pick";
import { FakeJudge } from "../auto-pick/testing";
import { type Conversation, Conversations } from "../conversations";
import { until } from "../conversations/testing";
import { message } from "../fixtures";
import type { Event } from "../records";
import { Testing } from "../testing";
import { routing } from "./index";

const AGENT = { id: "fake", name: "Fake", argv: ["fake-acp"] };

describe("routing", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let judge: Judge | null;

	const NOTE =
		"---\ndescription: How releases bundle\n---\nEach entry bundles.";
	const start = async () => {
		const conversation = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.root,
		});
		await until(conversation, "idle");
		return conversation;
	};
	const say = async (conversation: Conversation, words: string) => {
		await conversation.prompt(words);
		await until(conversation, "idle");
	};
	const lastPrompt = () =>
		(agent.prompts.at(-1) ?? []).flatMap((block) =>
			block.type === "text" ? [block.text] : [],
		);
	const attached = async () =>
		(await deps.journal.tail(50)).filter(
			(each): each is Extract<Event, { action: "notes attached" }> =>
				each.action === "notes attached",
		);

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(`${deps.dir}/conversations`, [AGENT], {
			storage: deps.storage.within("conversations"),
			launch: agent.launch,
		});
		judge = new FakeJudge({ n0: 0.9, n1: 0.75 });
		conversations.route = routing(deps, {
			judge: async () => judge,
			random: () => 0.5,
		});
		await deps.fs.mkdir(`${deps.root}/notes`);
		await deps.fs.write(`${deps.root}/notes/bundles.md`, NOTE);
		await deps.fs.write(
			`${deps.root}/notes/tests.md`,
			"---\ndescription: How tests run\n---\nIn a slot.",
		);
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("attaches the notes the judge finds bear on the message, after it, and records the judgment", async () => {
		const conversation = await start();
		await say(conversation, "Add an export for the new module");

		expect(lastPrompt()).toEqual([
			"Add an export for the new module",
			"Read before acting: notes/bundles.md: How releases bundle\nMaybe relevant: notes/tests.md: How tests run",
		]);
		expect((judge as FakeJudge).asked[0]?.state).toMatchObject({
			message: "Add an export for the new module",
			notes: {
				n0: { path: "notes/bundles.md", body: "Each entry bundles." },
			},
		});
		expect(await attached()).toEqual([
			expect.objectContaining({
				conversation: conversation.id,
				holdout: false,
				notes: [
					{
						path: "notes/bundles.md",
						probability: 0.9,
						tier: "now",
						inContext: false,
						updated: false,
					},
					{
						path: "notes/tests.md",
						probability: 0.75,
						tier: "optional",
						inContext: false,
						updated: false,
					},
				],
			}),
		]);
		expect(conversation.state.notesHoldout).toBe(false);
	});

	it("asks whether the message corrects the agent, given its last reply, and records it with what the judgment cost", async () => {
		judge = new FakeJudge({ n0: 0.1, n1: 0.1, corrects: 0.8 }, 0.002);
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: saying("Renamed it.") });
			return "end_turn";
		};
		const conversation = await start();
		await say(conversation, "Rename the export");
		await say(conversation, "No, the other one");

		const second = (judge as FakeJudge).asked[1];
		expect(second?.state).toMatchObject({
			message: "No, the other one",
			reply: "Renamed it.",
		});
		expect(second?.questions.corrects?.type).toBe("noul");
		expect((judge as FakeJudge).asked[0]?.state).toMatchObject({
			reply: null,
		});
		expect(
			(await attached()).map(({ corrects, dollars }) => ({
				corrects,
				dollars,
			})),
		).toEqual([
			{ corrects: 0.8, dollars: 0.002 },
			{ corrects: 0.8, dollars: 0.002 },
		]);
	});

	it("attaches nothing to a held-out conversation, but records what it would have", async () => {
		const draws = [0.1, 0.9];
		conversations.route = routing(deps, {
			judge: async () => judge,
			random: () => draws.shift() ?? 0,
		});
		const conversation = await start();
		await say(conversation, "Add an export for the new module");
		await say(conversation, "And another");

		expect(lastPrompt()).toEqual(["And another"]);
		expect(conversation.state.notesHoldout).toBe(true);
		const events = await attached();
		expect(events.map((each) => each.holdout)).toEqual([true, true]);
		expect(events.map((each) => each.notes?.[0]?.tier)).toEqual(["now", "now"]);
	});

	it("skips a note the agent read and holds unchanged, and attaches it again once edited", async () => {
		const conversation = await start();
		await deps.journal
			.in(conversation.id)
			.record("note read", null, async () => {}, {
				path: "notes/bundles.md",
				hash: createHash("sha256").update(NOTE).digest("hex"),
				tool: "t1",
				subagent: false,
			});
		await say(conversation, "Add an export");
		expect(lastPrompt()[1]).toBe(
			"Maybe relevant: notes/tests.md: How tests run",
		);

		await deps.fs.write(`${deps.root}/notes/bundles.md`, `${NOTE}\nAnd more.`);
		await say(conversation, "Add another");
		expect(lastPrompt()[1]).toBe(
			"Read before acting: notes/bundles.md (updated since you read it): How releases bundle\nMaybe relevant: notes/tests.md: How tests run",
		);
	});

	it("attaches a note read before the agent compacted its context", async () => {
		const conversation = await start();
		await deps.journal
			.in(conversation.id)
			.record("note read", null, async () => {}, {
				path: "notes/bundles.md",
				hash: createHash("sha256").update(NOTE).digest("hex"),
				tool: "t1",
				subagent: false,
			});
		conversation.state.messages.push(
			message("agent", {
				type: "compaction",
				id: "c1",
				status: "completed",
				trigger: "automatic",
				before: 100,
				after: 10,
				summary: null,
				at: new Date(Date.now() + 1000).toISOString(),
				until: null,
			}),
		);
		await say(conversation, "Add an export");
		expect(lastPrompt()[1]).toStartWith(
			"Read before acting: notes/bundles.md: How releases bundle",
		);
	});

	it("attaches nothing and records nothing without a judge", async () => {
		judge = null;
		const conversation = await start();
		await say(conversation, "Add an export");

		expect(lastPrompt()).toEqual(["Add an export"]);
		expect(await attached()).toEqual([]);
	});

	it("enrolls before a failed judgment, draws a balanced holdout once, and keeps it on retry", async () => {
		judge = null;
		conversations.route = routing(deps, {
			judge: async () => judge,
			random: () => 0.3,
		});
		const conversation = await start();
		await say(conversation, "Add an export");
		expect(conversation.state.notesHoldout).toBe(true);
		expect(conversation.state.notesExperiment?.version).toBe("notes-v2");
		expect(
			(await deps.journal.tail(50)).filter(
				(event) => event.action === "notes assigned",
			),
		).toHaveLength(1);
		expect(
			(await deps.journal.tail(50)).filter(
				(event) => event.action === "notes routing failed",
			),
		).toHaveLength(1);
		judge = new FakeJudge({ n0: 0.9 });
		conversations.route = routing(deps, {
			judge: async () => judge,
			random: () => 0.9,
		});
		await say(conversation, "Try again");
		expect(lastPrompt()).toEqual(["Try again"]);
		expect(conversation.state.notesHoldout).toBe(true);
		expect((await attached())[0]?.version).toBe("notes-v2");
	});

	it("keeps an existing assignment in the original phase", async () => {
		const conversation = await start();
		conversation.set({ notesHoldout: false });
		await say(conversation, "Add an export");
		expect(conversation.state.notesExperiment).toBeNull();
		expect((await attached())[0]?.version).toBeUndefined();
		expect(
			(await deps.journal.tail(50)).filter(
				(event) => event.action === "notes assigned",
			),
		).toEqual([]);
	});

	it("records a failed judge without delivering pointers or losing enrollment", async () => {
		judge = new FailedJudge();
		const conversation = await start();
		await say(conversation, "Add an export");
		expect(lastPrompt()).toEqual(["Add an export"]);
		expect(conversation.state.notesExperiment?.version).toBe("notes-v2");
		expect(
			(await deps.journal.tail(50)).filter(
				(event) => event.action === "notes routing failed",
			),
		).toEqual([
			expect.objectContaining({ failure: "judge failed", version: "notes-v2" }),
		]);
	});

	it("leaves a conversation with prior agent work in the historical phase even if not assigned yet", async () => {
		const conversation = await start();
		conversation.state.messages.push(
			message("agent", { type: "text", text: "Earlier work" }),
		);
		await say(conversation, "Add an export");
		expect(conversation.state.notesExperiment).toBeNull();
		expect((await attached())[0]?.version).toBeUndefined();
	});
});

class FailedJudge extends FakeJudge {
	override async judge(): Promise<never> {
		throw new Error("judge unavailable");
	}
}

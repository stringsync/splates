import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Agent } from "../agents";
import { FakeAgent } from "../agents/testing";
import { type Conversation, Conversations } from "../conversations";
import { eventually, until } from "../conversations/testing";
import { add } from "../tasks";
import { Testing } from "../testing";
import { type AutoPickWords, startAutoPick } from "./index";
import { FakeJudge } from "./testing";

/** A second agent for Auto pick to choose over the one the rules fall back on. */
const OTHER: Agent = { id: "other", name: "Other", argv: ["other-acp"] };

/** A judge sure the task is easy mechanical work. */
const LIGHT_EDIT = {
	"kind:bugfix": 0.9,
	"kind:open": 0.1,
	"depth:shallow": 0.8,
	"depth:deep": 0.1,
};

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

describe("startAutoPick", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let judge: FakeJudge | null;
	let id: number;

	const start = (
		target: AutoPickWords = { todo: id },
		gate: Promise<void> = Promise.resolve(),
	): Promise<Conversation> =>
		startAutoPick({
			project: deps,
			conversations,
			target,
			judge: () => gate.then(() => judge),
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
	const record = async () => (await deps.tasks.store.read(id))?.autoPick;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.dir}/conversations`,
			[AGENT, OTHER],
			{ storage: deps.storage.within("conversations"), launch: agent.launch },
		);
		judge = new FakeJudge(LIGHT_EDIT);
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({
				agents: [ROSTERED, { ...OTHER, models: [] }],
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
						picks: [{ agent: "other", model: "small" }],
					},
					{
						kind: "*",
						depth: "*",
						picks: [{ agent: "fake", model: "big" }],
					},
				],
			}),
		);
		({ id } = await deps.tasks.add("Rename `foo` to `bar`", null, {
			text: "In src/names.ts only.",
		}));
	});

	afterEach(async () => {
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("opens at once on the rule for any task, then on the judge's pick", async () => {
		const gate = Promise.withResolvers<void>();
		const conversation = await start({ todo: id }, gate.promise);
		expect(conversation.state).toMatchObject({ agent: "fake", picking: true });
		expect(agent.launched).toEqual([]);

		gate.resolve();
		await until(conversation, "idle");

		expect(conversation.state).toMatchObject({
			agent: "other",
			picking: false,
		});
		expect(agent.launched.map((each) => each.argv)).toEqual([["other-acp"]]);
		expect(await record()).toMatchObject({
			pick: { agent: "other", model: "small" },
			rule: 0,
			kind: "bugfix",
			depth: "shallow",
			classified: {
				classification: {
					kinds: {},
					depth: { shallow: 0.8 },
				},
			},
		});
		expect(await deps.journal.tail(10)).toContainEqual(
			expect.objectContaining({
				action: "auto",
				conversation: conversation.id,
				agent: "other",
				model: "small",
				signs: ["Bugfix 90%", "Shallow 80%"],
			}),
		);
	});

	it("judges a new conversation's first message, keeping no task record", async () => {
		const conversation = await start({ words: "Rename foo\nIn src only." });
		await until(conversation, "idle");

		expect(conversation.state.agent).toBe("other");
		expect(judge?.asked[0]?.state).toMatchObject({
			subject: "Rename foo",
			detail: "In src only.",
		});
		expect((await deps.tasks.store.read(id))?.autoPick).toBeUndefined();
		expect(await deps.journal.tail(10)).toContainEqual(
			expect.objectContaining({ action: "auto", agent: "other" }),
		);
	});

	it("gives the judge first-message attachment names and kinds without contents", async () => {
		const conversation = await start({
			words: "Check the layout",
			attachments: [{ name: "header.png", mimeType: "image/png" }],
		});
		await until(conversation, "idle");
		expect(judge?.asked[0]?.state.attachments).toBe("1 image (header.png)");
	});

	it("asks the judge again only once the task's words change", async () => {
		await until(await start(), "idle");
		const again = await start();
		await until(again, "idle");
		expect(judge?.asked).toHaveLength(1);
		expect(again.state.agent).toBe("other");

		await deps.tasks
			.find(id)
			.then((task) => task.update({ text: "Across every package." }));
		await until(await start(), "idle");
		expect(judge?.asked).toHaveLength(2);
	});

	it("reads a started task's plan goal when it has no text of its own", async () => {
		await add(deps, "alpha");
		const { path } = await deps.service.find("alpha");
		await deps.fs.write(
			`${path}/SPLATES.md`,
			"# alpha\n\n## Goal\n\nShip the login.\n",
		);

		await until(await start({ task: "alpha" }), "idle");

		expect(judge?.asked[0]?.state).toMatchObject({
			subject: "alpha",
			detail: "Ship the login.",
		});
		expect((await deps.tasks.store.find("alpha"))?.autoPick?.pick.agent).toBe(
			"other",
		);
	});

	it("never names an agent splates can't run here, landing on one that runs", async () => {
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({
				agents: [
					ROSTERED,
					{ ...OTHER, models: [] },
					{ id: "third", name: "Third", argv: ["third-acp"], models: [] },
				],
			}),
		);
		await deps.fs.write(
			`${deps.splatesHome}/auto-pick.json`,
			JSON.stringify({
				format: 2,
				threshold: 0.5,
				rules: [{ kind: "*", depth: "*", picks: [{ agent: "third" }] }],
			}),
		);

		const conversation = await start();
		await until(conversation, "idle");

		expect(conversation.state.agent).toBe("fake");
		expect(await record()).toMatchObject({
			pick: { agent: "fake" },
			reasons: expect.arrayContaining(["passed over Third: can't run here"]),
		});
		expect(await deps.journal.tail(10)).toContainEqual(
			expect.objectContaining({ action: "auto", agent: "fake" }),
		);
	});

	it("refuses a task there is no record of", async () => {
		expect(
			await start({ task: "missing" }).catch((error) => error),
		).toMatchObject({ reason: "not_found" });
	});

	it("takes the rule for any task with no judge, says why, and asks once for the judge's key", async () => {
		judge = null;
		const first = await start();
		await until(first, "idle");
		await until(await start(), "idle");

		expect(first.state.agent).toBe("fake");
		const kept = await record();
		expect(kept?.classified).toBeUndefined();
		expect(kept?.reasons[1]).toStartWith("no judge");
		const events = await deps.journal.tail(20);
		expect(events).toContainEqual(
			expect.objectContaining({ action: "auto", signs: null, agent: "fake" }),
		);
		await eventually(async () =>
			(await deps.journal.tail(20)).some(
				(each) => each.action === "creds request",
			),
		);
		expect(
			(await deps.journal.tail(20)).filter(
				(each) => each.action === "creds request",
			),
		).toEqual([
			expect.objectContaining({ name: "TYPESAFE_API_KEY", asked: true }),
		]);
	});
});

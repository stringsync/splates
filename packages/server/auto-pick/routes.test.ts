import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent, ROSTERED } from "../agents/testing";
import type { StoredTask } from "../board";
import { Conversations } from "../conversations";
import { eventually } from "../conversations/testing";
import { dev } from "../server";
import { json } from "../server/testing";
import { Testing } from "../testing";
import { classificationKey } from "./key";
import type { AutoPicked } from "./record";
import type { AutoPickTrial } from "./trial";

describe("dev Auto pick", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	let server: Awaited<ReturnType<typeof dev>>;
	/** A queued task, {@link SUBJECT}, by its number. */
	let id: number;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		await deps.fs.write(
			`${deps.splatesHome}/agents.json`,
			JSON.stringify({ agents: [ROSTERED] }),
		);
		await deps.fs.write(
			`${deps.splatesHome}/auto-pick.json`,
			JSON.stringify({
				format: 1,
				threshold: 0.5,
				rules: [
					{
						kind: "*",
						difficulty: "*",
						picks: [{ agent: "fake", model: "big" }],
					},
				],
			}),
		);
		({ id } = await deps.tasks.add(SUBJECT, null));
		server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		// The queue judges a task as it is added, so a test reads its record after.
		await eventually(
			async () => (await deps.tasks.store.read(id))?.autoPick !== undefined,
		);
	});

	afterEach(async () => {
		await server.disposeAsync();
		await deps.disposeAsync();
	});

	it("starts a queued task on the pick, answering before it is made, and keeps it on the task", async () => {
		const started = (await (
			await json(server.port, "/api/conversations/auto", "POST", { todo: id })
		).json()) as {
			id: string;
			agent: string;
			picking: boolean;
			assigned: boolean;
		};
		expect(started).toMatchObject({
			agent: "fake",
			picking: true,
			assigned: true,
		});

		await (await conversations.find(started.id)).opening;
		expect((await deps.tasks.store.read(id))?.autoPick?.pick).toEqual({
			agent: "fake",
			model: "big",
		});
	}, 15_000);

	it("tries a task on the judge's earlier word, starting nothing and leaving its record", async () => {
		const record = await deps.tasks.store.read(id);
		await deps.tasks.store.write({ ...(record as StoredTask), autoPick: KEPT });
		const trial = (await (
			await json(server.port, "/api/auto-pick/try", "POST", { todo: id })
		).json()) as AutoPickTrial;

		expect(trial).toMatchObject({
			subject: SUBJECT,
			classification: KEPT.classified?.classification,
			cached: true,
			decision: {
				pick: { agent: "fake", model: "big" },
				rule: 0,
				kind: "mechanical",
				difficulty: "easy",
			},
		});
		expect((await conversations.list()).length).toBe(0);
		expect((await deps.tasks.store.read(id))?.autoPick).toEqual(KEPT);
	}, 15_000);

	it("tries a task with no judge on the rule for any task, saying why", async () => {
		const before = (await deps.tasks.store.read(id))?.autoPick;
		const trial = (await (
			await json(server.port, "/api/auto-pick/try", "POST", { todo: id })
		).json()) as AutoPickTrial;

		expect(trial).toMatchObject({
			classification: null,
			cached: false,
			decision: { pick: { agent: "fake", model: "big" }, kind: null },
		});
		expect(trial.decision.reasons[1]).toStartWith("no judge:");
		expect((await deps.tasks.store.read(id))?.autoPick).toEqual(before);
	}, 15_000);

	it("refuses a body that names no task", async () => {
		const refused = await json(
			server.port,
			"/api/conversations/auto",
			"POST",
			{},
		);
		expect(refused.status).toBe(400);
	}, 15_000);
});

/** The queued task each test has. */
const SUBJECT = "Rename `foo` to `bar`";

/** An earlier Auto pick of {@link SUBJECT}, with what the judge said of its words. */
const KEPT: AutoPicked = {
	pick: { agent: "fake" },
	rule: 0,
	kind: "mechanical",
	difficulty: "easy",
	reasons: ["Fake on its default model"],
	at: "2026-10-19T00:00:00.000Z",
	classified: {
		key: classificationKey(SUBJECT, ""),
		classification: {
			kinds: {
				lookup: 0.1,
				mechanical: 0.9,
				bugfix: 0.1,
				design: 0.1,
				open: 0.1,
			},
			difficulty: { easy: 0.8, medium: 0.2, hard: 0.1 },
		},
	},
};

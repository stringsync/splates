import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AGENT, FakeAgent, say } from "../agents/testing";
import type { Attribution, Judge } from "../auto-pick";
import { FakeJudge } from "../auto-pick/testing";
import { type ConversationState, Conversations } from "../conversations";
import { until } from "../conversations/testing";
import { conversation, message, second, tool } from "../fixtures";
import type { Event } from "../records";
import { Testing } from "../testing";
import { weighing } from "./index";

describe("weighing", () => {
	let deps: Testing;
	let judge: Judge | null;
	let state: ConversationState;

	const turn = (...parts: Parameters<typeof message>[1][]) => {
		state.messages.push({ ...message("agent", ...parts), at: second(10) });
	};
	const weigh = () =>
		weighing(deps, {
			judge: async (who) => {
				asked.push(who);
				return judge;
			},
		})({ state, cwd: deps.root }, second(5));
	let asked: Partial<Attribution>[] = [];
	const applied = async () =>
		(await deps.journal.tail(50)).filter(
			(each): each is Extract<Event, { action: "note applied" }> =>
				each.action === "note applied",
		);

	beforeEach(async () => {
		deps = await Testing.open();
		judge = new FakeJudge({ n0: 0.85, n1: 0.1 }, 0.002);
		asked = [];
		state = conversation({ id: "one", task: "fix" });
		await deps.fs.mkdir(`${deps.root}/notes`);
		await deps.fs.write(
			`${deps.root}/notes/bundles.md`,
			"---\ndescription: How releases bundle\n---\nEach entry bundles.",
		);
		await deps.fs.write(
			`${deps.root}/notes/tests.md`,
			"---\ndescription: How tests run\n---\nIn a slot.",
		);
	});

	afterEach(() => deps.disposeAsync());

	it("asks whether each note read in the turn was applied, and records each with the tier its pointer had and its share of the cost", async () => {
		await deps.journal
			.in("one")
			.record("notes attached", "fix", async () => {}, {
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
						probability: 0.2,
						tier: null,
						inContext: false,
						updated: false,
					},
				],
				holdout: false,
				ms: 10,
			});
		turn(
			tool({ id: "t1", command: `cat ${deps.root}/notes/bundles.md` }),
			tool({
				id: "t2",
				kind: "read",
				title: "Read tests.md",
				paths: [`${deps.root}/notes/tests.md`],
			}),
			tool({
				id: "t3",
				kind: "edit",
				title: "Edit package.json",
				edits: [{ path: "package.json", old: null, new: "{}" }],
			}),
			"Added the export.",
		);
		await weigh();

		expect((judge as FakeJudge).asked[0]?.state).toEqual({
			actions: [
				`cat note.txt: cat ${deps.root}/notes/bundles.md`,
				`Read tests.md: ${deps.root}/notes/tests.md`,
				"Edit package.json",
			],
			edited: ["package.json"],
			reply: "Added the export.",
			notes: {
				n0: { path: "notes/bundles.md", body: "Each entry bundles." },
				n1: { path: "notes/tests.md", body: "In a slot." },
			},
		});
		expect(await applied()).toEqual([
			expect.objectContaining({
				conversation: "one",
				task: "fix",
				path: "notes/bundles.md",
				probability: 0.85,
				tier: "now",
				dollars: 0.001,
			}),
			expect.objectContaining({
				path: "notes/tests.md",
				probability: 0.1,
				tier: "unprompted",
				dollars: 0.001,
			}),
		]);
		expect(asked).toEqual([
			{ task: "fix", conversation: "one", purpose: "notes" },
		]);
	});

	it("weighs only the turn that ended, and nothing when it read no note", async () => {
		state.messages.push({
			...message("agent", tool({ command: `cat ${deps.root}/notes/tests.md` })),
			at: second(1),
		});
		turn(tool({ command: "ls" }), "Done.");
		await weigh();

		expect((judge as FakeJudge).asked).toEqual([]);
		expect(await applied()).toEqual([]);
	});

	it("records nothing without a judge", async () => {
		judge = null;
		turn(tool({ command: `cat ${deps.root}/notes/tests.md` }));
		await weigh();

		expect(await applied()).toEqual([]);
	});

	it("is asked once each turn ends, with when it began, no later than the reply", async () => {
		const agent = new FakeAgent();
		agent.turn = async (client, sessionId) => {
			await client.sessionUpdate({ sessionId, update: say("Added.") });
			return "end_turn";
		};
		const conversations = new Conversations(
			`${deps.dir}/conversations`,
			[AGENT],
			{ storage: deps.storage.within("conversations"), launch: agent.launch },
		);
		const weighed: string[] = [];
		conversations.weigh = async (_, since) => {
			weighed.push(since);
		};
		const started = await conversations.start(AGENT.id, {
			task: null,
			cwd: deps.root,
		});
		await until(started, "idle");
		await started.prompt("Add an export");
		await until(started, "idle");
		await conversations.disposeAsync();

		expect(weighed).toHaveLength(1);
		const reply = started.state.messages.at(-1);
		expect(reply?.role).toBe("agent");
		expect((reply?.at ?? "") >= (weighed[0] ?? "~")).toBe(true);
	});
});

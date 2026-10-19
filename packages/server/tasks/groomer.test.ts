import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import type { TaskRecord } from "../board";
import { Conversations, SERVER_TOLD } from "../conversations";
import { DEFAULT_AGENTS } from "../models";
import { DIRECTIVES } from "../plans";
import { Testing } from "../testing";
import { Groomer, groomerPick } from "./groomer";
import { SeenGroomed } from "./seen-groomed";

describe("Groomer", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let said: string[];
	let conversations: Conversations;
	let list: TaskRecord[];
	let groomer: Groomer | null;

	const until = async (done: () => boolean) => {
		for (let i = 0; i < 200 && !done(); i++) {
			await Bun.sleep(10);
		}
	};

	const queued = (id: number, more: Partial<TaskRecord> = {}): TaskRecord => ({
		id,
		subject: `Task ${id}`,
		text: "",
		position: id,
		from: "alpha",
		createdAt: "2026-10-18T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		stage: "backlog",
		...more,
	});

	const watch = async () => {
		groomer = Groomer.watch({
			queued: async () => list,
			conversations,
			root: deps.root,
			seen: new SeenGroomed(deps.fs, `${deps.splatesDir}/groomed-tasks`),
			log: new MemoryLogger(),
			timer: new FakeTimer(),
		});
		await groomer.sweep();
		return groomer;
	};

	/** A groomer watching, told of queued task 2 as it was added after queued task 1. */
	const groomedOne = async () => {
		const watching = await watch();
		list = [...list, queued(2)];
		await watching.sweep();
		await until(() => said.length === 1);
		return watching;
	};

	const live = async () =>
		(await conversations.list()).filter(({ state }) => !state.archived);

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		said = [];
		agent.turn = async (_, __, text) => {
			said.push(text);
			return "end_turn";
		};
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch },
		);
		list = [queued(1)];
		groomer = null;
	});

	afterEach(async () => {
		groomer?.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("leaves the queued tasks already on the list as it first opens", async () => {
		await watch();

		expect(await live()).toEqual([]);
	});

	it("starts one groomer in the main tree for a queued task added since, told by splates", async () => {
		await groomedOne();

		const [groomer] = await live();
		expect(said).toEqual(["[SPLATES GROOM #2]"]);
		expect(groomer?.cwd).toBe(deps.root);
		expect(groomer?.state.task).toBeNull();
		expect(groomer?.state.messages[0]?.told).toBe(SERVER_TOLD);
	});

	it("tells the groomer it has of the next, rather than start another", async () => {
		const watching = await groomedOne();
		list = [...list, queued(3), queued(4)];

		await watching.sweep();
		// Told while it is busy, what it hears may queue as one message.
		const told = () => said.flatMap((text) => text.match(DIRECTIVES) ?? []);
		await until(() => told().length === 3);

		expect(await live()).toHaveLength(1);
		expect(told()).toEqual([
			"[SPLATES GROOM #2]",
			"[SPLATES GROOM #3]",
			"[SPLATES GROOM #4]",
		]);
	});

	it("hands each queued task over once, past a restart", async () => {
		(await groomedOne()).dispose();

		await watch();
		await Bun.sleep(20);

		expect(said).toEqual(["[SPLATES GROOM #2]"]);
	});

	// scry-ignore simple-test-setup: archiving the groomer it has is the case it checks
	it("starts another once the person archived the groomer", async () => {
		const watching = await groomedOne();
		const [first] = await live();
		await first?.archive();
		list = [...list, queued(3)];

		await watching.sweep();
		await until(() => said.length === 2);

		const [second] = await live();
		expect(second?.id).not.toBe(first?.id);
		expect(second?.state.messages[0]?.parts).toEqual([
			{ type: "text", text: "[SPLATES GROOM #3]" },
		]);
	});

	it("leaves a queued task the person added, or one placed, taken or from another project", async () => {
		const watching = await watch();
		list = [
			...list,
			queued(2, { from: null }),
			queued(3, { lane: 1 }),
			queued(4, { takenBy: "beta" }),
			queued(5, { origin: { project: "/elsewhere", task: "beta" } }),
		];

		await watching.sweep();
		await Bun.sleep(20);

		expect(await live()).toEqual([]);
	});

	it("runs as the first agent on its cheapest model that can judge a queued task's", () => {
		expect(groomerPick(DEFAULT_AGENTS)).toEqual({
			agent: "claude",
			model: "sonnet",
		});
		expect(groomerPick([AGENT])).toEqual({ agent: AGENT.id });
	});
});

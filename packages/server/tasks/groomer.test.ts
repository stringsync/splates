import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeTimer } from "webappwiz/time/testing";
import { AGENT, FakeAgent } from "../agents/testing";
import type { TodoState } from "../board";
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
	let list: TodoState[];
	let groomer: Groomer | null;

	const until = async (done: () => boolean) => {
		for (let i = 0; i < 200 && !done(); i++) {
			await Bun.sleep(10);
		}
	};

	const todo = (id: number, more: Partial<TodoState> = {}): TodoState => ({
		id,
		subject: `Todo ${id}`,
		text: "",
		position: id,
		from: "alpha",
		createdAt: "2026-10-18T00:00:00.000Z",
		takenBy: null,
		files: [],
		blockedBy: [],
		lane: null,
		...more,
	});

	const watch = async () => {
		groomer = Groomer.watch({
			todos: async () => list,
			conversations,
			root: deps.root,
			seen: new SeenGroomed(deps.fs, `${deps.splatesDir}/groomed-todos`),
			log: new MemoryLogger(),
			timer: new FakeTimer(),
		});
		await groomer.sweep();
		return groomer;
	};

	/** A groomer watching, told of todo 2 as it was added after todo 1. */
	const groomedOne = async () => {
		const watching = await watch();
		list = [...list, todo(2)];
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
		list = [todo(1)];
		groomer = null;
	});

	afterEach(async () => {
		groomer?.dispose();
		await conversations.disposeAsync();
		await deps.disposeAsync();
	});

	it("leaves the todos already on the list as it first opens", async () => {
		await watch();

		expect(await live()).toEqual([]);
	});

	it("starts one groomer in the main tree for a todo added since, told by splates", async () => {
		await groomedOne();

		const [groomer] = await live();
		expect(said).toEqual(["[SPLATES GROOM #2]"]);
		expect(groomer?.cwd).toBe(deps.root);
		expect(groomer?.state.task).toBeNull();
		expect(groomer?.state.messages[0]?.told).toBe(SERVER_TOLD);
	});

	it("tells the groomer it has of the next, rather than start another", async () => {
		const watching = await groomedOne();
		list = [...list, todo(3), todo(4)];

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

	it("hands each todo over once, past a restart", async () => {
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
		list = [...list, todo(3)];

		await watching.sweep();
		await until(() => said.length === 2);

		const [second] = await live();
		expect(second?.id).not.toBe(first?.id);
		expect(second?.state.messages[0]?.parts).toEqual([
			{ type: "text", text: "[SPLATES GROOM #3]" },
		]);
	});

	it("leaves a todo the person added, or one placed, taken or from another project", async () => {
		const watching = await watch();
		list = [
			...list,
			todo(2, { from: null }),
			todo(3, { lane: 1 }),
			todo(4, { takenBy: "beta" }),
			todo(5, { origin: { project: "/elsewhere", task: "beta" } }),
		];

		await watching.sweep();
		await Bun.sleep(20);

		expect(await live()).toEqual([]);
	});

	it("runs as the first agent on its cheapest model that can judge a todo's", () => {
		expect(groomerPick(DEFAULT_AGENTS)).toEqual({
			agent: "claude",
			model: "sonnet",
		});
		expect(groomerPick([AGENT])).toEqual({ agent: AGENT.id });
	});
});

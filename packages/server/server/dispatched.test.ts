import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { OpenPortProvider } from "webappwiz/system";
import { AGENT, FakeAgent, ROSTERED } from "../agents/testing";
import { taskAdd } from "../board";
import { Conversations } from "../conversations";
import { Offered } from "../models";
import { queueAdd } from "../queue";
import { FsStorage } from "../storage";
import { add, startDispatched } from "../tasks";
import { Testing } from "../testing";
import { dev } from "./server";

describe("dev dispatched", () => {
	let deps: Testing;
	let agent: FakeAgent;
	let conversations: Conversations;
	/** What the agent was first told. */
	let told: PromiseWithResolvers<string>;

	beforeEach(async () => {
		deps = await Testing.open();
		agent = new FakeAgent();
		told = Promise.withResolvers<string>();
		agent.turn = async (_, __, text) => {
			told.resolve(text);
			return "end_turn";
		};
		agent.options = [
			...agent.options,
			{
				id: "effort",
				name: "Effort",
				category: "thought_level",
				type: "select",
				currentValue: "default",
				options: [
					{ value: "default", name: "Default" },
					{ value: "high", name: "High" },
				],
			},
		];
		const offered = new Offered(
			new FsStorage(deps.splatesHome, deps.fs).document("offered.json"),
		);
		await offered.remember("fake", [
			{
				id: "effort",
				name: "Effort",
				type: "select",
				category: "thought_level",
				current: "default",
				options: [
					{ value: "default", name: "Default", description: null },
					{ value: "high", name: "High", description: null },
				],
			},
		]);
		conversations = new Conversations(
			`${deps.splatesDir}/conversations`,
			[AGENT],
			{ launch: agent.launch, offered },
		);
	});

	afterEach(() => deps.disposeAsync());

	it("starts the agent of a task handed to one at the thinking level it was handed", async () => {
		await add(deps, "alpha", {
			dispatch: { agent: "fake", effort: "high" },
			agents: [ROSTERED],
		});
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			await told.promise;

			expect(agent.chosen).toEqual([{ configId: "effort", value: "high" }]);
		} finally {
			await server.disposeAsync();
		}
	});

	it("hands a queued task to the conversation the queue held for it, starting no other", async () => {
		await taskAdd(deps, "Alpha", null);
		await queueAdd(deps, [1]);
		const held = await conversations.start("fake", {
			task: null,
			cwd: deps.service.git.root,
			assigned: true,
			capped: true,
			queued: 1,
			title: "#1 Alpha",
		});
		await add(deps, "alpha", {
			tasks: [1],
			dispatch: { agent: "fake", held: held.id },
			agents: [ROSTERED],
		});
		const server = await dev(deps, {
			ports: OpenPortProvider.any(),
			conversations: () => conversations,
		});
		try {
			expect(await told.promise).toContain("[SPLATES TASK alpha]");

			expect(
				(await conversations.list()).map(({ state }) => ({
					id: state.id,
					task: state.task,
					queued: state.queued,
					archived: state.archived,
				})),
			).toEqual([
				{ id: held.id, task: "alpha", queued: null, archived: false },
			]);
		} finally {
			await server.disposeAsync();
		}
	});

	it("starts the rest when one task's agent cannot start, trying that one again next time", async () => {
		await add(deps, "alpha", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		await add(deps, "beta", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		await (await deps.service.find("alpha")).save({
			dispatch: { agent: "gone" },
		});
		const log = new MemoryLogger();

		await startDispatched({ service: deps.service, conversations, log });

		expect((await conversations.list()).map(({ state }) => state.task)).toEqual(
			["beta"],
		);
		expect((await deps.service.find("alpha")).state?.dispatch).toEqual({
			agent: "gone",
		});
	});

	it("starts the agent of a task whose splates add died before it cleared pending, but not while that add runs", async () => {
		await add(deps, "alpha", {
			dispatch: { agent: "fake" },
			agents: [ROSTERED],
		});
		const worktree = await (await deps.service.find("alpha")).save({
			dispatch: { agent: "fake", pending: true },
			lease: {
				pid: deps.ps.pid,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});
		const log = new MemoryLogger();

		await startDispatched({ service: deps.service, conversations, log });
		expect(await conversations.list()).toEqual([]);

		await worktree.save({
			lease: {
				pid: 2 ** 22 + 1,
				hostname: deps.ps.hostname,
				heartbeatAt: new Date().toISOString(),
			},
		});
		await startDispatched({ service: deps.service, conversations, log });

		expect((await conversations.list()).map(({ state }) => state.task)).toEqual(
			["alpha"],
		);
		const { dispatch, lease } = (await deps.service.find("alpha")).state ?? {};
		expect(dispatch?.pending).toBeUndefined();
		expect(lease).toBeNull();
	});
});

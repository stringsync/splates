import { describe, expect, it } from "bun:test";
import { enqueued, taskAdd } from "../board";
import { type Conversations, NoopConversations } from "../conversations";
import { Testing } from "../testing";
import { AgentChainStore } from "./agent-chains";
import { AgentQueueLedgerStore } from "./agent-ledger";
import { AgentQueueRoutes } from "./agent-routes";
import {
	type AgentQueueAuthorizeResult,
	AgentQueueSettingsStore,
	DEFAULT_AGENT_QUEUE_SETTINGS,
} from "./agent-settings";

function fakeConversations(
	entries: { id: string; task: string | null; lastTask?: string | null }[],
): Conversations {
	return {
		list: async () =>
			entries.map((entry) => ({
				state: {
					id: entry.id,
					task: entry.task,
					lastTask: entry.lastTask ?? entry.task,
					usage: { input: 0, cached: 0, output: 0 },
				},
			})),
	} as unknown as Conversations;
}

describe("agent queue settings and authorization", () => {
	it("defaults to Never with cap 5 and persists updates", async () => {
		await using deps = await Testing.open();
		const store = new AgentQueueSettingsStore(
			deps.storage.document("agent-queue.json"),
		);

		expect(await store.read()).toEqual(DEFAULT_AGENT_QUEUE_SETTINGS);

		expect(await store.update({ level: "safe" })).toEqual({
			level: "safe",
			perConversationCap: 5,
			quotaReserve: 0.25,
			chainBudget: 5_000_000,
		});
		expect(await store.update({ perConversationCap: 10 })).toEqual({
			level: "safe",
			perConversationCap: 10,
			quotaReserve: 0.25,
			chainBudget: 5_000_000,
		});
		expect(await store.update({ quotaReserve: 0.5 })).toEqual({
			level: "safe",
			perConversationCap: 10,
			quotaReserve: 0.5,
			chainBudget: 5_000_000,
		});
		expect(await store.read()).toEqual({
			level: "safe",
			perConversationCap: 10,
			quotaReserve: 0.5,
			chainBudget: 5_000_000,
		});
	});

	it("refuses PUT /api/agent-settings without same-origin fetch header, and saves with it", async () => {
		await using deps = await Testing.open();
		const routes = new AgentQueueRoutes(
			deps,
			new NoopConversations(),
			new AgentQueueSettingsStore(deps.storage.document("agent-queue.json")),
			new AgentQueueLedgerStore(
				deps.storage.document("agent-queue-counts.json"),
			),
			new AgentChainStore(deps.storage.document("agent-queue-chains.json")),
		);

		const refused = await routes.saveAgentSettings(
			new Request("http://localhost/api/agent-settings", {
				method: "PUT",
				body: JSON.stringify({ level: "any" }),
			}),
		);
		expect(refused.status).toBe(403);

		const saved = await routes.saveAgentSettings(
			new Request("http://localhost/api/agent-settings", {
				method: "PUT",
				headers: { "sec-fetch-site": "same-origin" },
				body: JSON.stringify({ level: "safe", perConversationCap: 3 }),
			}),
		);
		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual({
			level: "safe",
			perConversationCap: 3,
			quotaReserve: 0.25,
			chainBudget: 5_000_000,
		});

		const read = await routes.readAgentSettings();
		expect(await read.json()).toEqual({
			level: "safe",
			perConversationCap: 3,
			quotaReserve: 0.25,
			chainBudget: 5_000_000,
		});
	});

	it("enforces level and per-conversation cap, and propagates chain root across generations", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Root task", null); // #1
		await taskAdd(deps, "Child one", null); // #2
		await taskAdd(deps, "Child two", null); // #3
		await taskAdd(deps, "Child three", null); // #4
		await taskAdd(deps, "Grandchild", null); // #5

		// Root conversation works on task #1 ("root-slug")
		await (await deps.tasks.find(1)).take("root-slug");

		const settings = new AgentQueueSettingsStore(
			deps.storage.document("agent-queue.json"),
		);
		const ledger = new AgentQueueLedgerStore(
			deps.storage.document("agent-queue-counts.json"),
		);
		const conversations = fakeConversations([
			{ id: "conv-root", task: "root-slug" },
			{ id: "conv-child", task: "child-slug" },
		]);
		const routes = new AgentQueueRoutes(
			deps,
			conversations,
			settings,
			ledger,
			new AgentChainStore(deps.storage.document("agent-queue-chains.json")),
		);

		const authorize = async (
			conversation: string,
			ids: number[],
		): Promise<AgentQueueAuthorizeResult> => {
			const response = await routes.authorizeAgentQueue(
				new Request("http://localhost/api/queue/agent-authorize", {
					method: "POST",
					body: JSON.stringify({ conversation, ids }),
				}),
			);
			expect(response.status).toBe(200);
			return (await response.json()) as AgentQueueAuthorizeResult;
		};

		// Default is Never
		expect(await authorize("conv-root", [2])).toEqual({
			allowed: false,
			reason: "never",
			level: "never",
			queued: 0,
			cap: 5,
		});

		// Enable safe tasks with cap 2
		await settings.update({ level: "safe", perConversationCap: 2 });

		// First queue succeeds and establishes conv-root / root-slug / #1 as root
		const first = await authorize("conv-root", [2]);
		expect(first).toEqual({
			allowed: true,
			level: "safe",
			queued: 1,
			cap: 2,
			by: {
				by: "agent",
				conversation: "conv-root",
				task: "root-slug",
				fromTask: 1,
				root: {
					conversation: "conv-root",
					task: "root-slug",
					boardTask: 1,
				},
			},
		});

		// Re-queueing the same task ID does not double-count
		const repeat = await authorize("conv-root", [2]);
		expect(repeat.allowed).toBe(true);
		expect(repeat.queued).toBe(1);

		// Second distinct task hits the cap of 2
		const second = await authorize("conv-root", [3]);
		expect(second.allowed).toBe(true);
		expect(second.queued).toBe(2);

		// Third task exceeds the per-conversation cap
		expect(await authorize("conv-root", [4])).toEqual({
			allowed: false,
			reason: "cap",
			level: "safe",
			queued: 2,
			cap: 2,
		});

		// Record #2 as agent-queued and taken by conv-child ("child-slug")
		const firstBy = {
			by: "agent" as const,
			conversation: "conv-root",
			task: "root-slug",
			fromTask: 1,
			root: {
				conversation: "conv-root",
				task: "root-slug",
				boardTask: 1,
			},
		};
		expect(first).toEqual({
			allowed: true,
			level: "safe",
			queued: 1,
			cap: 2,
			by: firstBy,
		});
		await deps.tasks.revise(2, (state) => enqueued(state, firstBy));
		await (await deps.tasks.find(2)).take("child-slug");

		// conv-child has its own per-conversation cap of 2 and inherits conv-root as chain root
		const grand = await authorize("conv-child", [5]);
		expect(grand).toEqual({
			allowed: true,
			level: "safe",
			queued: 1,
			cap: 2,
			by: {
				by: "agent",
				conversation: "conv-child",
				task: "child-slug",
				fromTask: 2,
				root: {
					conversation: "conv-root",
					task: "root-slug",
					boardTask: 1,
				},
			},
		});
	});

	it("holds a chain once its tasks spent the budget, until the person adds more or stops it", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Root task", null); // #1
		await taskAdd(deps, "Child", null); // #2
		await taskAdd(deps, "Next", null); // #3
		await (await deps.tasks.find(1)).take("root-slug");
		const settings = new AgentQueueSettingsStore(
			deps.storage.document("agent-queue.json"),
		);
		await settings.update({ level: "any", chainBudget: 1_000_000 });
		const spent = { input: 3_000_000, cached: 2_500_000, output: 600_000 };
		const conversations = {
			list: async () => [
				{
					state: {
						id: "conv-root",
						task: "root-slug",
						lastTask: "root-slug",
						usage: { input: 9e9, cached: 0, output: 9e9 },
					},
				},
				{
					state: {
						id: "conv-child",
						task: "child-slug",
						lastTask: "child-slug",
						usage: spent,
					},
				},
			],
		} as unknown as Conversations;
		const routes = new AgentQueueRoutes(
			deps,
			conversations,
			settings,
			new AgentQueueLedgerStore(
				deps.storage.document("agent-queue-counts.json"),
			),
			new AgentChainStore(deps.storage.document("agent-queue-chains.json")),
		);
		const post = async (
			path: string,
			payload: unknown,
			handler: (request: Request) => Promise<Response>,
		) =>
			(
				await handler(
					new Request(`http://localhost${path}`, {
						method: "POST",
						body: JSON.stringify(payload),
					}),
				)
			).json();
		const authorize = (conversation: string, ids: number[]) =>
			post(
				"/api/queue/agent-authorize",
				{ conversation, ids },
				routes.authorizeAgentQueue,
			) as Promise<AgentQueueAuthorizeResult>;

		expect((await authorize("conv-root", [2])).allowed).toBe(true);
		await (await deps.tasks.find(2)).take("child-slug");

		// 3.0M input less 2.5M cached, plus 0.6M output is 1.1M; the root's own use never counts.
		const held = await authorize("conv-child", [3]);
		expect(held).toMatchObject({
			allowed: false,
			reason: "budget",
			chain: {
				name: "root-slug",
				spent: 1_100_000,
				budget: 1_000_000,
				stopped: false,
			},
		});

		await post(
			"/api/queue/agent-budget",
			{ conversation: "conv-child", add: 2_000_000 },
			routes.changeChainBudget,
		);
		expect((await authorize("conv-child", [3])).allowed).toBe(true);

		await post(
			"/api/queue/agent-budget",
			{ conversation: "conv-child", stop: true },
			routes.changeChainBudget,
		);
		expect(await authorize("conv-child", [3])).toMatchObject({
			allowed: false,
			reason: "stopped",
		});
	});
	it("reads a chain's tree from any conversation in it, and null from one outside", async () => {
		await using deps = await Testing.open();
		await taskAdd(deps, "Root task", null); // #1
		await taskAdd(deps, "Child", null); // #2
		await taskAdd(deps, "Grandchild", null); // #3
		await (await deps.tasks.find(1)).take("root-slug");
		const settings = new AgentQueueSettingsStore(
			deps.storage.document("agent-queue.json"),
		);
		await settings.update({ level: "any", chainBudget: 2_000_000 });
		const state = (id: string, task: string | null, output: number) => ({
			state: {
				id,
				task,
				lastTask: task,
				name: null,
				title: null,
				usage: { input: 0, cached: 0, output },
			},
		});
		const conversations = {
			list: async () => [
				state("conv-root", "root-slug", 9e9),
				state("conv-child", "child-slug", 400_000),
				state("conv-loner", null, 0),
			],
		} as unknown as Conversations;
		const routes = new AgentQueueRoutes(
			deps,
			conversations,
			settings,
			new AgentQueueLedgerStore(
				deps.storage.document("agent-queue-counts.json"),
			),
			new AgentChainStore(deps.storage.document("agent-queue-chains.json")),
			() => new Set([3]),
		);
		const authorize = (conversation: string, ids: number[]) =>
			routes.authorizeAgentQueue(
				new Request("http://localhost/api/queue/agent-authorize", {
					method: "POST",
					body: JSON.stringify({ conversation, ids }),
				}),
			);
		await authorize("conv-root", [2]);
		await (await deps.tasks.find(2)).take("child-slug");
		await authorize("conv-child", [3]);
		const read = async (conversation: string) =>
			(
				await routes.readChain(
					new Request(
						`http://localhost/api/queue/agent-chain?conversation=${conversation}`,
					),
				)
			).json();

		expect(await read("conv-loner")).toBeNull();
		const fromChild = await read("conv-child");
		expect(fromChild).toEqual(await read("conv-root"));
		expect(fromChild).toMatchObject({
			name: "root-slug",
			root: { conversation: "conv-root", title: "root-slug" },
			spent: 400_000,
			budget: 2_000_000,
			stopped: false,
			nodes: [
				{
					id: 2,
					status: "running",
					parent: 1,
					conversation: "conv-child",
					tokens: 400_000,
				},
				{ id: 3, status: "held", parent: 2, conversation: null },
			],
		});
	});
});

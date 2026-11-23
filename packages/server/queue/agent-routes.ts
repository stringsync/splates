import { z } from "zod";
import type { ChainRoot, QueuedBy } from "../board";
import type { Conversations } from "../conversations";
import { fail } from "../exit";
import type { Project } from "../server/shared";
import { body } from "../server/shared";
import type { AgentChainStore } from "./agent-chains";
import type { AgentQueueLedgerStore } from "./agent-ledger";
import {
	type AgentQueueAuthorizeResult,
	AgentQueueSettingsPatchSchema,
	type AgentQueueSettingsStore,
	type ChainBudgetReading,
} from "./agent-settings";
import type { ChainNode, ChainView } from "./chain-tree";

const BudgetBody = z.object({
	conversation: z.string().min(1),
	add: z.number().int().positive().optional(),
	stop: z.boolean().optional(),
});

const AuthorizeBody = z.object({
	conversation: z.string().min(1),
	ids: z.array(z.number().int().positive()).min(1),
});

/**
 * Project-scoped HTTP routes for per-project agent auto-queue settings and
 * server-side authorization of agent `splates queue add` calls.
 */
export class AgentQueueRoutes {
	readonly #project: Project;
	readonly #conversations: Pick<Conversations, "list">;
	readonly #settings: AgentQueueSettingsStore;
	readonly #ledger: AgentQueueLedgerStore;
	readonly #chains: AgentChainStore;
	readonly #held: () => ReadonlySet<number>;

	constructor(
		project: Project,
		conversations: Pick<Conversations, "list">,
		settings: AgentQueueSettingsStore,
		ledger: AgentQueueLedgerStore,
		chains: AgentChainStore,
		held: () => ReadonlySet<number> = () => new Set(),
	) {
		this.#held = held;
		this.#project = project;
		this.#conversations = conversations;
		this.#settings = settings;
		this.#ledger = ledger;
		this.#chains = chains;
	}

	/** Reads this project's agent auto-queue settings. */
	readonly readAgentSettings = async (): Promise<Response> =>
		Response.json(await this.#settings.read());

	/** Saves this project's agent auto-queue settings when changed from the page. */
	readonly saveAgentSettings = async (request: Request): Promise<Response> => {
		// Browsers send Sec-Fetch-Site: same-origin on page requests; CLI/agent calls do not.
		if (request.headers.get("sec-fetch-site") !== "same-origin") {
			return Response.json(
				{
					reason: "forbidden",
					message: "Only the user can change agent settings from the page",
				},
				{ status: 403 },
			);
		}
		const raw = await body(request);
		const parsed = AgentQueueSettingsPatchSchema.safeParse(raw);
		if (!parsed.success) {
			fail("usage", "invalid agent queue settings", {
				issues: parsed.error.issues,
			});
		}
		const saved = await this.#settings.update(parsed.data);
		return Response.json(saved);
	};

	/**
	 * Decides whether an agent conversation may queue the requested task ids
	 * under this project's setting and per-conversation cap, returning the
	 * `QueuedBy` provenance (with chain root) when allowed.
	 */
	readonly authorizeAgentQueue = async (
		request: Request,
	): Promise<Response> => {
		const raw = await body(request);
		const parsed = AuthorizeBody.safeParse(raw);
		if (!parsed.success) {
			fail("usage", "agent queue authorization requires conversation and ids");
		}
		const { conversation, ids } = parsed.data;
		const settings = await this.#settings.read();
		const already = await this.#ledger.idsOf(conversation);
		if (settings.level === "never") {
			const answer: AgentQueueAuthorizeResult = {
				allowed: false,
				reason: "never",
				level: settings.level,
				queued: already.length,
				cap: settings.perConversationCap,
			};
			return Response.json(answer);
		}
		const adding = ids.filter((id) => !already.includes(id));
		if (already.length + adding.length > settings.perConversationCap) {
			const answer: AgentQueueAuthorizeResult = {
				allowed: false,
				reason: "cap",
				level: settings.level,
				queued: already.length,
				cap: settings.perConversationCap,
			};
			return Response.json(answer);
		}
		const provenance = await this.#resolveProvenance(conversation);
		const chain = await this.#reading(provenance.root, settings.chainBudget);
		if (chain.stopped || chain.spent >= chain.budget) {
			const answer: AgentQueueAuthorizeResult = {
				allowed: false,
				reason: chain.stopped ? "stopped" : "budget",
				level: settings.level,
				queued: already.length,
				cap: settings.perConversationCap,
				chain,
			};
			return Response.json(answer);
		}
		// Verify every requested task exists and is not already taken before
		// counting it against the conversation's cap.
		const found = await Promise.all(
			ids.map((id) => this.#project.tasks.find(id)),
		);
		const taken = found.find((task) => task.takenBy !== null);
		if (taken !== undefined) {
			fail(
				"exists",
				`task ${taken.id} is under way as '${taken.takenBy}', so it is past the queue: nothing was queued`,
				{ number: taken.id, takenBy: taken.takenBy },
			);
		}
		const queued = await this.#ledger.record(conversation, ids, provenance);
		const by: Extract<QueuedBy, { by: "agent" }> = {
			by: "agent",
			conversation: provenance.conversation,
			task: provenance.task,
			...(provenance.fromTask === undefined
				? {}
				: { fromTask: provenance.fromTask }),
			root: provenance.root,
		};
		const answer: AgentQueueAuthorizeResult = {
			allowed: true,
			by,
			level: settings.level,
			queued,
			cap: settings.perConversationCap,
		};
		return Response.json(answer);
	};

	/**
	 * Changes the budget of the chain the asking conversation belongs to, as
	 * the agent applies the person's answer to the out-of-budget question:
	 * adds tokens to it, or stops auto for it.
	 */
	readonly changeChainBudget = async (request: Request): Promise<Response> => {
		const parsed = BudgetBody.safeParse(await body(request));
		if (
			!parsed.success ||
			(parsed.data.add === undefined && parsed.data.stop !== true)
		) {
			fail(
				"usage",
				"a chain budget change needs a conversation and --add or --stop",
			);
		}
		const { root } = await this.#resolveProvenance(parsed.data.conversation);
		await this.#chains.change(root.conversation, parsed.data);
		const settings = await this.#settings.read();
		return Response.json(await this.#reading(root, settings.chainBudget));
	};

	/**
	 * What each chain with agent-queued tasks has spent, against its budget,
	 * keyed by the root conversation, for the page's chips and banners.
	 */
	readonly chainSpends = async (): Promise<Response> => {
		const ledger = await this.#ledger.read();
		const base = (await this.#settings.read()).chainBudget;
		const roots = new Map<string, ChainRoot>();
		for (const each of Object.values(ledger.tasks)) {
			roots.set(each.root.conversation, each.root);
		}
		const out: Record<string, ChainBudgetReading> = {};
		for (const [key, root] of roots) {
			out[key] = await this.#reading(root, base);
		}
		return Response.json(out);
	};

	/**
	 * The task chain `?conversation=` belongs to, for its widget: the budget
	 * and every agent-queued task under the chain's root. Null for a
	 * conversation no agent-queued task hangs from.
	 */
	readonly readChain = async (request: Request): Promise<Response> => {
		const conversation = new URL(request.url).searchParams.get("conversation");
		if (conversation === null || conversation === "") {
			fail("usage", "reading a chain needs ?conversation=");
		}
		const { root } = await this.#resolveProvenance(conversation);
		const ledger = await this.#ledger.read();
		const members = Object.entries(ledger.tasks).filter(
			([, each]) => each.root.conversation === root.conversation,
		);
		if (members.length === 0) {
			return Response.json(null);
		}
		const open = await this.#project.tasks.stored();
		const finished = await this.#project.service.finished.list();
		const all = await this.#conversations.list();
		const held = this.#held();
		const tokensOf = (id: string | null): number => {
			const found = all.find((each) => each.state.id === id);
			if (found === undefined) {
				return 0;
			}
			const { usage } = found.state;
			return Math.max(0, usage.input - usage.cached) + usage.output;
		};
		const nodes: ChainNode[] = members.map(([key, from]) => {
			const id = Number(key);
			const parent = from.fromTask ?? null;
			const task = open.find((each) => each.id === id);
			if (task !== undefined) {
				const running = task.takenBy !== null;
				const conversationId = running
					? (all.find((each) => each.state.task === task.takenBy)?.state.id ??
						null)
					: null;
				return {
					id,
					title: task.subject,
					status: running ? "running" : held.has(id) ? "held" : "queued",
					parent,
					conversation: conversationId,
					tokens: tokensOf(conversationId),
				};
			}
			const done = finished.find((each) =>
				each.took.some((took) => took.id === id),
			);
			return {
				id,
				title: done?.took.find((took) => took.id === id)?.subject ?? `#${id}`,
				status: done?.ended === "merged" ? "merged" : "removed",
				parent,
				conversation: done?.conversation ?? null,
				tokens: tokensOf(done?.conversation ?? null),
			};
		});
		const settings = await this.#settings.read();
		const reading = await this.#reading(root, settings.chainBudget);
		const rootConversation = all.find(
			(each) => each.state.id === root.conversation,
		);
		const view: ChainView = {
			name: reading.name,
			root: {
				conversation: root.conversation,
				title:
					rootConversation?.state.name ??
					rootConversation?.state.title ??
					root.task ??
					"this conversation",
			},
			spent: reading.spent,
			budget: reading.budget,
			stopped: reading.stopped,
			nodes,
		};
		return Response.json(view);
	};

	/** What `root`'s chain has spent, against what it may. */
	async #reading(root: ChainRoot, base: number): Promise<ChainBudgetReading> {
		const decision = await this.#chains.of(root.conversation);
		return {
			name: root.task ?? root.conversation,
			spent: await this.#spent(root.conversation),
			budget: base + decision.extra,
			stopped: decision.stopped,
		};
	}

	/**
	 * Tokens the chain's agent-queued tasks spent: fresh input and output of
	 * every conversation that took one of them, cache reads left out. The
	 * root's own work does not count.
	 */
	async #spent(rootConversation: string): Promise<number> {
		const ledger = await this.#ledger.read();
		const ids = Object.entries(ledger.tasks)
			.filter(([, each]) => each.root.conversation === rootConversation)
			.map(([id]) => Number(id));
		if (ids.length === 0) {
			return 0;
		}
		const slugs = new Set<string>();
		for (const task of await this.#project.tasks.stored()) {
			if (ids.includes(task.id) && task.takenBy !== null) {
				slugs.add(task.takenBy);
			}
		}
		for (const done of await this.#project.service.finished.list()) {
			if (done.took.some((took) => ids.includes(took.id))) {
				slugs.add(done.task);
			}
		}
		let total = 0;
		for (const each of await this.#conversations.list()) {
			const slug = each.state.task ?? each.state.lastTask ?? null;
			if (slug !== null && slugs.has(slug)) {
				const { usage } = each.state;
				total += Math.max(0, usage.input - usage.cached) + usage.output;
			}
		}
		return total;
	}

	async #resolveProvenance(conversationId: string): Promise<{
		conversation: string;
		task: string | null;
		fromTask?: number;
		root: ChainRoot;
	}> {
		const conv = (await this.#conversations.list()).find(
			(each) => each.state.id === conversationId,
		);
		const taskSlug = conv?.state.task ?? conv?.state.lastTask ?? null;
		let boardTaskId: number | undefined;
		let inheritedRoot: ChainRoot | undefined;

		if (taskSlug !== null) {
			const open = (await this.#project.tasks.stored()).find(
				(each) => each.takenBy === taskSlug,
			);
			if (open !== undefined) {
				boardTaskId = open.id;
				if (open.queuedBy?.by === "agent") {
					inheritedRoot = open.queuedBy.root;
				}
			} else {
				const finished = (await this.#project.service.finished.list()).find(
					(each) => each.task === taskSlug,
				);
				const took = finished?.took[0];
				if (took !== undefined) {
					boardTaskId = took.id;
				}
			}
			if (inheritedRoot === undefined && boardTaskId !== undefined) {
				const prior = await this.#ledger.provenanceOf(boardTaskId);
				if (prior !== null) {
					inheritedRoot = prior.root;
				}
			}
		}

		const root: ChainRoot = inheritedRoot ?? {
			conversation: conversationId,
			task: taskSlug,
			...(boardTaskId === undefined ? {} : { boardTask: boardTaskId }),
		};
		return {
			conversation: conversationId,
			task: taskSlug,
			...(boardTaskId === undefined ? {} : { fromTask: boardTaskId }),
			root,
		};
	}
}

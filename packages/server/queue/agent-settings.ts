import { z } from "zod";
import type { QueuedBy } from "../board";
import type { Document } from "../storage";

/** Reads and writes one project's agent auto-queue settings on the server. */
export class AgentQueueSettingsStore {
	readonly #doc: Document<AgentQueueSettings>;

	constructor(doc: Document<AgentQueueSettings>) {
		this.#doc = doc;
	}

	async read(): Promise<AgentQueueSettings> {
		const stored = await this.#doc.read();
		if (stored === null) {
			return { ...DEFAULT_AGENT_QUEUE_SETTINGS };
		}
		const parsed = AgentQueueSettingsSchema.safeParse(stored);
		return parsed.success ? parsed.data : { ...DEFAULT_AGENT_QUEUE_SETTINGS };
	}

	async update(
		patch: Partial<AgentQueueSettings>,
	): Promise<AgentQueueSettings> {
		const current = await this.read();
		const next = AgentQueueSettingsSchema.parse({
			...current,
			...(patch.level === undefined ? {} : { level: patch.level }),
			...(patch.perConversationCap === undefined
				? {}
				: { perConversationCap: patch.perConversationCap }),
			...(patch.quotaReserve === undefined
				? {}
				: { quotaReserve: patch.quotaReserve }),
			...(patch.chainBudget === undefined
				? {}
				: { chainBudget: patch.chainBudget }),
		});
		await this.#doc.write(next);
		return next;
	}
}

/** How much an agent may queue on its own for a project. */
export const AGENT_QUEUE_LEVELS = ["never", "safe", "any"] as const;

export type AgentQueueLevel = (typeof AGENT_QUEUE_LEVELS)[number];

/** Preset values offered in Settings for the per-conversation cap. */
export const AGENT_QUEUE_CAP_PRESETS = [3, 5, 10] as const;

/** Preset values offered in Settings for the chain token budget. */
export const AGENT_QUEUE_BUDGET_PRESETS = [
	2_000_000, 5_000_000, 10_000_000,
] as const;

/** Per-project server settings for agent auto-queue. */
export interface AgentQueueSettings {
	/** Whether an agent may run `splates queue add` itself. */
	level: AgentQueueLevel;
	/** Most tasks one conversation's agent may queue before falling back to a queue card. */
	perConversationCap: number;
	/** Fraction of each plan window, 0 to 1, that agent-queued tasks leave unused: they wait while every agent they could go to has less left. */
	quotaReserve: number;
	/**
	 * Tokens one task chain's agent-queued tasks may spend (fresh input and
	 * output, cache reads left out) before its agents must ask for more.
	 */
	chainBudget: number;
}

/** Preset reserves offered in Settings, as fractions. */
export const AGENT_QUEUE_RESERVE_PRESETS = [0.1, 0.25, 0.5] as const;

/** Defaults when a project has never saved agent queue settings. */
export const DEFAULT_AGENT_QUEUE_SETTINGS: AgentQueueSettings = {
	level: "never",
	perConversationCap: 5,
	quotaReserve: 0.25,
	chainBudget: 5_000_000,
};

/** Schema for persisted agent queue settings; missing fields default safely. */
export const AgentQueueSettingsSchema: z.ZodType<AgentQueueSettings> = z.object(
	{
		level: z.enum(AGENT_QUEUE_LEVELS).default("never"),
		perConversationCap: z.number().int().min(1).default(5),
		quotaReserve: z.number().min(0).max(1).default(0.25),
		chainBudget: z.number().int().min(1).default(5_000_000),
	},
);

/** Patch accepted by `PUT /api/agent-settings`. */
export const AgentQueueSettingsPatchSchema = z.object({
	level: z.enum(AGENT_QUEUE_LEVELS).optional(),
	perConversationCap: z.number().int().min(1).optional(),
	quotaReserve: z.number().min(0).max(1).optional(),
	chainBudget: z.number().int().min(1).optional(),
});

/** Server answer when an agent asks whether it may run `splates queue add`. */
export type AgentQueueAuthorizeResult =
	| {
			allowed: true;
			by: Extract<QueuedBy, { by: "agent" }>;
			level: AgentQueueLevel;
			queued: number;
			cap: number;
	  }
	| {
			allowed: false;
			reason: "never" | "cap";
			level: AgentQueueLevel;
			queued: number;
			cap: number;
	  }
	| {
			allowed: false;
			/** The chain spent its budget, or the person stopped auto for it. */
			reason: "budget" | "stopped";
			level: AgentQueueLevel;
			queued: number;
			cap: number;
			chain: ChainBudgetReading;
	  };

/** Where a task chain stands against its token budget. */
export interface ChainBudgetReading {
	/** The chain's name: its root task, else its root conversation. */
	name: string;
	/** Tokens its agent-queued tasks have spent. */
	spent: number;
	/** What it may spend: the setting plus what the person added. */
	budget: number;
	stopped: boolean;
}

/** `5000000` as `5M` and `600000` as `0.6M`, the way budgets are said. */
export function tokensSaid(tokens: number): string {
	const millions = tokens / 1_000_000;
	return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
}

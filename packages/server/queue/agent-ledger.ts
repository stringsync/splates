import type { ChainRoot } from "../board";
import type { Document } from "../storage";

/** Tracks per-conversation agent-queued counts and task chain provenance. */
export class AgentQueueLedgerStore {
	readonly #doc: Document<AgentQueueLedger>;

	constructor(doc: Document<AgentQueueLedger>) {
		this.#doc = doc;
	}

	async read(): Promise<AgentQueueLedger> {
		const stored = await this.#doc.read();
		if (stored === null) {
			return { byConversation: {}, tasks: {} };
		}
		return {
			byConversation: stored.byConversation ?? {},
			tasks: stored.tasks ?? {},
		};
	}

	/** Task numbers `conversation` has already queued. */
	async idsOf(conversation: string): Promise<number[]> {
		const ledger = await this.read();
		return ledger.byConversation[conversation] ?? [];
	}

	/** Recorded provenance for board task `id`, if an agent queued it. */
	async provenanceOf(id: number): Promise<AgentQueuedProvenance | null> {
		const ledger = await this.read();
		return ledger.tasks[String(id)] ?? null;
	}

	/** Records `ids` as queued by `conversation` with `provenance`; returns new count. */
	async record(
		conversation: string,
		ids: readonly number[],
		provenance: AgentQueuedProvenance,
	): Promise<number> {
		let count = 0;
		await this.#doc.update((existing) => {
			const base = existing ?? EMPTY_LEDGER;
			const prev = base.byConversation?.[conversation] ?? [];
			const merged = [...prev];
			for (const id of ids) {
				if (!merged.includes(id)) {
					merged.push(id);
				}
			}
			const nextTasks = { ...(base.tasks ?? {}) };
			for (const id of ids) {
				nextTasks[String(id)] = provenance;
			}
			count = merged.length;
			return {
				byConversation: {
					...(base.byConversation ?? {}),
					[conversation]: merged,
				},
				tasks: nextTasks,
			};
		});
		return count;
	}
}

/** Provenance kept for each agent-queued task, surviving merges and restarts. */
export interface AgentQueuedProvenance {
	conversation: string;
	task: string | null;
	fromTask?: number;
	root: ChainRoot;
}

/** Per-project ledger of tasks queued by agents. */
export interface AgentQueueLedger {
	/** Task numbers queued by each conversation (deduplicated). */
	byConversation: Record<string, number[]>;
	/** Provenance keyed by stringified board task number. */
	tasks: Record<string, AgentQueuedProvenance>;
}

const EMPTY_LEDGER: AgentQueueLedger = {
	byConversation: {},
	tasks: {},
};

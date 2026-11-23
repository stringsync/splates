import type { Document } from "../storage";

/** What the person decided for each task chain, keyed by its root conversation. */
export class AgentChainStore {
	readonly #doc: Document<Record<string, ChainDecision>>;

	constructor(doc: Document<Record<string, ChainDecision>>) {
		this.#doc = doc;
	}

	async of(root: string): Promise<ChainDecision> {
		const all = (await this.#doc.read()) ?? {};
		return all[root] ?? { extra: 0, stopped: false };
	}

	/** Adds `tokens` to the chain's budget, or stops auto for it. */
	async change(
		root: string,
		change: { add?: number; stop?: boolean },
	): Promise<ChainDecision> {
		let next: ChainDecision = { extra: 0, stopped: false };
		await this.#doc.update((existing) => {
			const all = existing ?? {};
			const was = all[root] ?? { extra: 0, stopped: false };
			next = {
				extra: was.extra + (change.add ?? 0),
				stopped: was.stopped || change.stop === true,
			};
			return { ...all, [root]: next };
		});
		return next;
	}
}

/** Tokens added to a chain's budget, and whether auto was stopped for it. */
export interface ChainDecision {
	extra: number;
	stopped: boolean;
}

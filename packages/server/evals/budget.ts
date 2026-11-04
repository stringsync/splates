import { fail } from "../exit";
import type { Document } from "../storage";
import type { EvalStore } from "./store";

/** What an eval conversation may spend: dollars across its runs, and how many runs (rounds). */
export interface EvalBudget {
	usd: number;
	rounds: number;
}

export const DEFAULT_EVAL_BUDGET: EvalBudget = { usd: 10, rounds: 3 };

/** One round a conversation started: its plan's worst case, and its batch once the runner made one. */
export interface EvalRound {
	/** The launch's id. */
	launch: string;
	worstUsd: number;
	batch: string | null;
}

/** A conversation's budget with the rounds it has started. */
export interface EvalLedger extends EvalBudget {
	runs: EvalRound[];
}

/** Which limit stopped a run. */
export type EvalLimit = "usd" | "rounds";

/** Where a conversation's budget stands, as the card shows it. */
export interface EvalBudgetStatus {
	budget: EvalBudget;
	spentUsd: number;
	tokens: number;
	roundsUsed: number;
	/** The limit that is used up, so no further run starts; null while both have room. */
	stoppedBy: EvalLimit | null;
}

/** The limit that is used up, the round cap first as `gate` checks it. */
export function stoppedBy(
	budget: EvalBudget,
	spentUsd: number,
	roundsUsed: number,
): EvalLimit | null {
	if (roundsUsed >= budget.rounds) {
		return "rounds";
	}
	return Math.round(spentUsd * 100) >= Math.round(budget.usd * 100)
		? "usd"
		: null;
}

export type EvalGateVerdict =
	| { ok: true }
	| { ok: false; limit: EvalLimit; reason: string };

/**
 * Whether a run whose plan comes to at most `worstUsd` fits `budget`, given
 * `spentUsd` so far and the `roundsUsed`. The round cap is checked first.
 */
export function gate(
	budget: EvalBudget,
	spentUsd: number,
	roundsUsed: number,
	worstUsd: number,
): EvalGateVerdict {
	if (roundsUsed >= budget.rounds) {
		return {
			ok: false,
			limit: "rounds",
			reason: `the round cap is reached: ${roundsUsed} of ${budget.rounds} rounds used`,
		};
	}
	// Cents, so sums of fractions do not tip a run that exactly fits.
	if (Math.round((spentUsd + worstUsd) * 100) > Math.round(budget.usd * 100)) {
		return {
			ok: false,
			limit: "usd",
			reason: `the dollar budget would be exceeded: $${spentUsd.toFixed(2)} spent plus up to $${worstUsd.toFixed(2)} for this run is over $${budget.usd.toFixed(2)}`,
		};
	}
	return { ok: true };
}

/** The budgets of eval conversations and the rounds each has started, kept in one document. */
export class EvalBudgets {
	constructor(private readonly record: Document<Record<string, EvalLedger>>) {}

	/** The conversation's budget, or null when it has none. */
	async budgetOf(conversation: string): Promise<EvalBudget | null> {
		const found = (await this.record.read())?.[conversation];
		return found === undefined
			? null
			: { usd: found.usd, rounds: found.rounds };
	}

	/**
	 * What the conversation's budget stands at: its limits, the dollars and
	 * tokens spent (a round with no cost in its batch counts at its plan's
	 * worst case), the rounds started, and the limit that is used up.
	 */
	async statusOf(
		conversation: string,
		store: EvalStore,
	): Promise<EvalBudgetStatus> {
		const budget = (await this.budgetOf(conversation)) ?? DEFAULT_EVAL_BUDGET;
		const rounds = await this.roundsOf(conversation);
		let spentUsd = 0;
		let tokens = 0;
		for (const round of rounds) {
			const grid = round.batch === null ? null : await store.grid(round.batch);
			spentUsd += grid?.costUsd ?? round.worstUsd;
			tokens += grid?.tokens ?? 0;
		}
		const roundsUsed = rounds.length;
		return {
			budget,
			spentUsd,
			tokens,
			roundsUsed,
			stoppedBy: stoppedBy(budget, spentUsd, roundsUsed),
		};
	}

	/** The rounds the conversation has started. */
	async roundsOf(conversation: string): Promise<EvalRound[]> {
		return (await this.record.read())?.[conversation]?.runs ?? [];
	}

	/**
	 * Sets the budget when the conversation has none, and answers with the one
	 * it has: a budget is fixed once set, so a later ask changes nothing.
	 */
	async set(
		conversation: string,
		budget: EvalBudget = DEFAULT_EVAL_BUDGET,
	): Promise<EvalBudget> {
		if (
			!Number.isFinite(budget.usd) ||
			budget.usd <= 0 ||
			!Number.isInteger(budget.rounds) ||
			budget.rounds < 1
		) {
			fail(
				"usage",
				"a budget is a positive dollar amount and a whole number of rounds",
				{},
			);
		}
		const all = await this.record.update((current) => {
			const each = current ?? {};
			return each[conversation] === undefined
				? { ...each, [conversation]: { ...budget, runs: [] } }
				: each;
		});
		const kept = all[conversation];
		return {
			usd: kept?.usd ?? budget.usd,
			rounds: kept?.rounds ?? budget.rounds,
		};
	}

	/** Records a round the conversation starts; the conversation gets the default budget if it has none. */
	async begin(conversation: string, round: EvalRound): Promise<void> {
		await this.record.update((current) => {
			const each = current ?? {};
			const ledger = each[conversation] ?? { ...DEFAULT_EVAL_BUDGET, runs: [] };
			return {
				...each,
				[conversation]: { ...ledger, runs: [...ledger.runs, round] },
			};
		});
	}

	/** Notes the batch a round wrote. */
	async landed(
		conversation: string,
		launch: string,
		batch: string,
	): Promise<void> {
		await this.change(conversation, launch, (round) => ({ ...round, batch }));
	}

	/** Gives back a round that spent nothing, one the runner refused. */
	async refund(conversation: string, launch: string): Promise<void> {
		await this.change(conversation, launch, null);
	}

	private async change(
		conversation: string,
		launch: string,
		edit: ((round: EvalRound) => EvalRound) | null,
	): Promise<void> {
		await this.record.update((current) => {
			const ledger = current?.[conversation];
			if (current === undefined || current === null || ledger === undefined) {
				return current ?? {};
			}
			return {
				...current,
				[conversation]: {
					...ledger,
					runs: ledger.runs.flatMap((round) =>
						round.launch !== launch
							? [round]
							: edit === null
								? []
								: [edit(round)],
					),
				},
			};
		});
	}
}

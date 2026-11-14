import { fail } from "../exit";
import type { Document } from "../storage";
import type { EvalStore } from "./store";

/** What a run card may spend: the dollars its person set when pressing Run. */
export interface EvalBudget {
	usd: number;
}

export const DEFAULT_EVAL_BUDGET: EvalBudget = { usd: 10 };

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

/** Where a conversation's latest run stands, as the card shows it. */
export interface EvalBudgetStatus {
	/** The latest run's budget. */
	budget: EvalBudget;
	/** What the latest run has cost so far; earlier runs have their own budgets and do not add in. */
	spentUsd: number;
	tokens: number;
}

/** The budget of each eval conversation's latest run and the runs it has started, kept in one document. */
export class EvalBudgets {
	constructor(private readonly record: Document<Record<string, EvalLedger>>) {}

	/** The budget of the conversation's latest run, or null when it has started none. */
	async budgetOf(conversation: string): Promise<EvalBudget | null> {
		const found = (await this.record.read())?.[conversation];
		return found === undefined ? null : { usd: found.usd };
	}

	/**
	 * Where the conversation's latest run stands: its budget, and what it has
	 * cost (a run with no cost in its batch yet counts as nothing).
	 */
	async statusOf(
		conversation: string,
		store: EvalStore,
	): Promise<EvalBudgetStatus> {
		const budget = (await this.budgetOf(conversation)) ?? DEFAULT_EVAL_BUDGET;
		const latest = (await this.roundsOf(conversation)).at(-1);
		const grid = latest?.batch == null ? null : await store.grid(latest.batch);
		return {
			budget,
			spentUsd: grid?.costUsd ?? 0,
			tokens: grid?.tokens ?? 0,
		};
	}

	/** The rounds the conversation has started. */
	async roundsOf(conversation: string): Promise<EvalRound[]> {
		return (await this.record.read())?.[conversation]?.runs ?? [];
	}

	/** Sets the budget of the run the conversation starts next, which a card starts with next time too. */
	async set(conversation: string, budget: EvalBudget): Promise<EvalBudget> {
		validate(budget);
		await this.record.update((current) => {
			const each = current ?? {};
			const ledger = each[conversation] ?? { ...DEFAULT_EVAL_BUDGET, runs: [] };
			return { ...each, [conversation]: { ...ledger, usd: budget.usd } };
		});
		return { usd: budget.usd };
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

function validate(budget: EvalBudget): void {
	if (!Number.isFinite(budget.usd) || budget.usd <= 0) {
		fail("usage", "a budget is a positive dollar amount", {});
	}
}

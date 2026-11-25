import { fail } from "../exit";
import type { Document } from "../storage";

/** One round a conversation started, and its batch once the runner made one. */
export interface EvalRound {
	/** The launch's id. */
	launch: string;
	batch: string | null;
}

/** The person's answer to one eval budget card, or an automation's pre-approved seed. */
export interface EvalGrant {
	/** The card's key, as the page names it (or `automation:<id>` when seeded). */
	card: string;
	/** Dollars it added; null when declined. */
	usd: number | null;
	/** When it was approved or seeded, as ISO 8601. */
	at: string;
	/** Set when seeded by an automation rather than approved by hand on a card. */
	automation?: { id: string; name?: string };
}

/** What the record keeps of one conversation: its rounds and its budget cards' answers. */
interface EvalLedger {
	runs: EvalRound[];
	grants?: EvalGrant[];
}

/** The most one card may add, in dollars. */
const MOST = 100_000;

/**
 * The rounds each eval conversation has started, and the budget its person
 * approved for them, kept in one document, so every batch a conversation ran
 * links back to it.
 */
export class EvalRounds {
	constructor(private readonly record: Document<Record<string, EvalLedger>>) {}

	/** The rounds the conversation has started. */
	async roundsOf(conversation: string): Promise<EvalRound[]> {
		return (await this.record.read())?.[conversation]?.runs ?? [];
	}

	/** The answers to the conversation's eval budget cards, oldest first. */
	async grantsOf(conversation: string): Promise<EvalGrant[]> {
		return (await this.record.read())?.[conversation]?.grants ?? [];
	}

	/**
	 * Records the person's answer to budget card `card`: `usd` dollars added,
	 * or null for declined. A card is answered once; a second answer is refused.
	 */
	async answer(
		conversation: string,
		card: string,
		usd: number | null,
		at: string,
	): Promise<void> {
		if (usd !== null && !(Number.isFinite(usd) && usd > 0 && usd <= MOST)) {
			fail("usage", "an eval budget is a dollar amount above 0", { usd });
		}
		await this.record.update((current) => {
			const each = current ?? {};
			const ledger = each[conversation] ?? { runs: [] };
			const grants = ledger.grants ?? [];
			if (grants.some((grant) => grant.card === card)) {
				fail("usage", "that eval budget card is already answered", { card });
			}
			const grant: EvalGrant = {
				card,
				usd: usd === null ? null : Math.round(usd * 100) / 100,
				at,
			};
			return {
				...each,
				[conversation]: { ...ledger, grants: [...grants, grant] },
			};
		});
	}

	/**
	 * Seeds a pre-approved eval budget onto `conversation` from `automation`,
	 * once per conversation. Nothing carries over across conversations.
	 */
	async seed(
		conversation: string,
		usd: number,
		at: string,
		automation: { id: string; name?: string },
	): Promise<void> {
		if (!(Number.isFinite(usd) && usd > 0 && usd <= MOST)) {
			fail("usage", "an eval budget is a dollar amount above 0", { usd });
		}
		const card = `automation:${automation.id}`;
		await this.record.update((current) => {
			const each = current ?? {};
			const ledger = each[conversation] ?? { runs: [] };
			const grants = ledger.grants ?? [];
			if (grants.some((grant) => grant.card === card)) {
				return each;
			}
			const grant: EvalGrant = {
				card,
				usd: Math.round(usd * 100) / 100,
				at,
				automation: {
					id: automation.id,
					...(automation.name === undefined || automation.name === ""
						? {}
						: { name: automation.name }),
				},
			};
			return {
				...each,
				[conversation]: { ...ledger, grants: [...grants, grant] },
			};
		});
	}

	/** Records a round the conversation starts. */
	async begin(conversation: string, round: EvalRound): Promise<void> {
		await this.record.update((current) => {
			const each = current ?? {};
			const ledger = each[conversation] ?? { runs: [] };
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

	/** Drops a round the runner refused, which ran nothing. */
	async drop(conversation: string, launch: string): Promise<void> {
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

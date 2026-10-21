import type { Storage } from "../storage";
import { type SpendEntry, type SpendQuery, totals } from "./totals";

/**
 * Every amount spent, in dollars, kept in `spend.jsonl` on the machine so it
 * survives restarts and any project's agents add to the one ledger. Nothing
 * else does the pricing: the Billing page reads totals from here.
 */
export class Spend {
	private readonly log;

	constructor(storage: Storage) {
		this.log = storage.log<SpendEntry>("spend.jsonl");
	}

	async record(...entries: SpendEntry[]): Promise<void> {
		const spent = entries.filter(
			(entry) => Number.isFinite(entry.dollars) && entry.dollars > 0,
		);
		if (spent.length > 0) {
			await this.log.append(...spent);
		}
	}

	async entries(): Promise<SpendEntry[]> {
		const entries = await this.log.replay();
		const segments = await this.log.segments();
		const older = await Promise.all(
			segments.map((segment) => this.log.replaySegment(segment)),
		);
		return [...older.flat(), ...entries];
	}

	async totals(query: SpendQuery = {}) {
		return totals(await this.entries(), query);
	}
}

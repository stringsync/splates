import type { Storage } from "../storage";
import { isRunnerRow, type RunnerJobRow, type RunnerRow } from "./runners";
import { type SpendEntry, type SpendQuery, totals } from "./totals";

/**
 * Every amount spent, in dollars, kept in `spend.jsonl` on the machine so it
 * survives restarts and any project's agents add to the one ledger. Nothing
 * else does the pricing: the Billing page reads totals from here. Runners
 * and the jobs they ran are kept here too, as rows of their own that are no
 * amount spent, kept forever, which their estimates are counted from.
 */
export class Spend {
	private readonly log;

	constructor(storage: Storage) {
		this.log = storage.log<SpendEntry | RunnerRow>("spend.jsonl");
	}

	async record(...entries: SpendEntry[]): Promise<void> {
		const spent = entries.filter(
			(entry) => Number.isFinite(entry.dollars) && entry.dollars > 0,
		);
		if (spent.length > 0) {
			await this.log.append(...spent);
		}
	}

	/** Keeps `rows` of runners and their jobs. */
	async note(...rows: RunnerRow[]): Promise<void> {
		if (rows.length > 0) {
			await this.log.append(...rows);
		}
	}

	/** Every amount spent, oldest first. */
	async entries(): Promise<SpendEntry[]> {
		return (await this.lines()).filter(
			(line): line is SpendEntry => !isRunnerRow(line),
		);
	}

	/** The jobs runners ran, oldest first. */
	async jobs(): Promise<RunnerJobRow[]> {
		return (await this.lines()).filter(
			(line): line is RunnerJobRow => isRunnerRow(line) && line.row === "job",
		);
	}

	/** Every line, amounts spent and runners' rows alike, oldest first. */
	async lines(): Promise<(SpendEntry | RunnerRow)[]> {
		const lines = await this.log.replay();
		const segments = await this.log.segments();
		const older = await Promise.all(
			segments.map((segment) => this.log.replaySegment(segment)),
		);
		return [...older.flat(), ...lines];
	}

	async totals(query: SpendQuery = {}) {
		return totals(await this.entries(), query);
	}
}

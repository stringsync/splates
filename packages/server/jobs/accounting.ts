import { Duration } from "webappwiz/time";
import type { Document, Storage } from "../storage";

/** How many past runs of one command are kept to estimate the next. */
export const RUNS_KEPT = 20;

/** One run of a job, as accounting keeps it. */
export interface JobRun {
	at: string;
	ms: number;
	allocation: Record<string, number>;
	outcome: "done" | "expired" | "preempted";
}

/**
 * What every job took, by command, so a command's next run can be expected
 * to take what its past runs did: the median, which backfill and
 * reservations need. Kept in the machine's storage, under `jobs/accounting`.
 */
export class Accounting {
	readonly #document: Document<Record<string, JobRun[]>>;

	constructor(storage: Storage) {
		this.#document = storage.document("jobs/accounting");
	}

	/** Records that `what` ran `ms`, keeping the last `RUNS_KEPT` of it. */
	async record(what: string, run: JobRun): Promise<void> {
		await this.#document.update((current) => {
			const runs = [...(current?.[what] ?? []), run].slice(-RUNS_KEPT);
			return { ...current, [what]: runs };
		});
	}

	/** How long `what` is expected to run: the median of its finished runs, or null with none. */
	async expected(what: string): Promise<Duration | null> {
		const runs = ((await this.#document.read())?.[what] ?? [])
			.filter((run) => run.outcome === "done")
			.map((run) => run.ms)
			.sort((one, other) => one - other);
		if (runs.length === 0) {
			return null;
		}
		const middle = Math.floor(runs.length / 2);
		return Duration.ms(
			runs.length % 2 === 1
				? (runs[middle] ?? 0)
				: ((runs[middle - 1] ?? 0) + (runs[middle] ?? 0)) / 2,
		);
	}
}

import type { RunnerJobRow, RunnerRow } from "../spend";

/**
 * Where runners' lives and the jobs they ran are kept for good: the
 * machine's spend ledger, which the Billing page counts runner cost from.
 */
export interface RunnerLedger {
	note(...rows: RunnerRow[]): Promise<void>;
	/** The jobs runners ran, oldest first, which how long the next will take is learned from. */
	jobs?(): Promise<RunnerJobRow[]>;
}

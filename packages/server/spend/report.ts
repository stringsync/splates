import type { Spend } from "./spend";
import { type SpendTotal, totals } from "./totals";

/** What the Billing page shows of a range: totals by service and by day. */
export interface SpendReport {
	/** When it was read, as an ISO timestamp. */
	updated: string;
	/** Each provider's services in the range. */
	services: SpendTotal[];
	/** Each provider's day, oldest first. */
	days: SpendTotal[];
}

/** The ledger's totals from `since` to `until` (ISO timestamps, either may be left off). */
export async function spendReport(
	ledger: Spend,
	range: { since?: string; until?: string; now: string },
): Promise<SpendReport> {
	const entries = await ledger.entries();
	const { since, until } = range;
	return {
		updated: range.now,
		services: totals(entries, { by: "service", since, until }),
		days: totals(entries, { by: "provider", per: "day", since, until }),
	};
}

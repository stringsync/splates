import type { Rates } from "./rates";
import type { Spend } from "./spend";
import { type SpendEntry, type SpendTotal, totals } from "./totals";

/** What the Billing page shows of a range: totals by service and by day. */
export interface SpendReport {
	/** When it was read, as an ISO timestamp. */
	updated: string;
	/** The currency the amounts are in. */
	currency: string;
	/** The latest day whose rate was used, or null when nothing was converted. */
	rateDate: string | null;
	/** Why the amounts are in dollars rather than `currency`, when no rate could be had. */
	rateError: string | null;
	/** Each provider's services in the range. */
	services: SpendTotal[];
	/** Each provider's day, oldest first. */
	days: SpendTotal[];
}

/**
 * The ledger's totals from `since` to `until` (ISO timestamps, either may be
 * left off), in the currency of `rates`, each entry at the rate of the day it
 * was spent. When a rate cannot be had the dollars are shown as dollars.
 */
export async function spendReport(
	ledger: Spend,
	range: { since?: string; until?: string; now: string; rates?: Rates },
): Promise<SpendReport> {
	const { since, until, rates } = range;
	const inRange = (await ledger.entries()).filter(
		(entry) =>
			(since === undefined || entry.at >= since) &&
			(until === undefined || entry.at < until),
	);
	let entries: SpendEntry[] = inRange;
	let currency = "USD";
	let rateDate: string | null = null;
	let rateError: string | null = null;
	if (rates !== undefined && rates.currency !== "USD") {
		try {
			const converted: SpendEntry[] = [];
			for (const entry of inRange) {
				// What was billed in its own currency converts exactly; the rest is dollars.
				const from = entry.original ?? {
					amount: entry.dollars,
					currency: "USD",
				};
				const day = entry.at.slice(0, 10);
				const made = await rates.convert(from.amount, from.currency, day);
				if (made.original.currency !== rates.currency) {
					rateDate = [rateDate, made.original.rateDate]
						.filter((each) => each !== null)
						.sort()
						.pop() as string;
				}
				converted.push({ ...entry, dollars: made.dollars });
			}
			entries = converted;
			currency = rates.currency;
		} catch (error) {
			rateError = String(error);
		}
	}
	return {
		updated: range.now,
		currency,
		rateDate,
		rateError,
		services: totals(entries, { by: "service" }),
		days: totals(entries, { by: "provider", per: "day" }),
	};
}

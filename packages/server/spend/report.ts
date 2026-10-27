import type { Expected } from "./plans";
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
	/**
	 * What is expected after the range and before the end of the month it
	 * ends in, by service: a plan's renewal or a subscription not invoiced.
	 */
	upcoming: SpendTotal[];
}

/**
 * The ledger's totals from `since` to `until` (ISO timestamps, either may be
 * left off), with each `expected` charge on its day, in the currency of
 * `rates`, each entry at the rate of the day it was spent. When a rate cannot
 * be had the dollars are shown as dollars.
 */
export async function spendReport(
	ledger: Spend,
	range: {
		since?: string;
		until?: string;
		now: string;
		rates?: Rates;
		expected?: readonly Expected[];
	},
): Promise<SpendReport> {
	const { since, until, rates } = range;
	const within = (at: string, from?: string, to?: string) =>
		(from === undefined || at >= from) && (to === undefined || at < to);
	const asEntry = (each: Expected): SpendEntry => ({
		at: `${each.day}T00:00:00.000Z`,
		provider: each.provider,
		service: each.service,
		kind: "expected",
		// Only dollars until converted below, as every expected charge is.
		dollars: each.amount,
		project: null,
		task: null,
		conversation: null,
		original: {
			amount: each.amount,
			currency: each.currency,
			rate: 1,
			rateDate: each.day,
		},
	});
	const expected = (range.expected ?? []).map(asEntry);
	const inRange = [...(await ledger.entries()), ...expected].filter((entry) =>
		within(entry.at, since, until),
	);
	const monthEnd = monthAfter(until ?? range.now);
	const ahead = expected.filter((entry) =>
		within(entry.at, until ?? range.now, monthEnd),
	);
	let entries: SpendEntry[] = inRange;
	let upcoming: SpendEntry[] = ahead;
	let currency = "USD";
	let rateDate: string | null = null;
	let rateError: string | null = null;
	if (rates !== undefined && rates.currency !== "USD") {
		try {
			const converted: SpendEntry[] = [];
			for (const entry of [...inRange, ...ahead]) {
				// What was billed in its own currency converts exactly; the rest is dollars.
				const from = entry.original ?? {
					amount: entry.dollars,
					currency: "USD",
				};
				// A charge still to come converts at today's rate, the latest there is.
				const day = [
					entry.at.slice(0, 10),
					range.now.slice(0, 10),
				].sort()[0] as string;
				const made = await rates.convert(from.amount, from.currency, day);
				if (made.original.currency !== rates.currency) {
					rateDate = [rateDate, made.original.rateDate]
						.filter((each) => each !== null)
						.sort()
						.pop() as string;
				}
				converted.push({ ...entry, dollars: made.dollars });
			}
			entries = converted.slice(0, inRange.length);
			upcoming = converted.slice(inRange.length);
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
		upcoming: totals(upcoming, { by: "service" }),
	};
}

/** The first moment of the month after the one `at` falls in, or of `at`'s own month when `at` is its first moment. */
function monthAfter(at: string): string {
	const date = new Date(Date.parse(at) - 1);
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
	).toISOString();
}

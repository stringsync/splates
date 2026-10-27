/** Money billed; plan use at API list prices; or a charge expected with no bill yet, which only the report adds. */
export type SpendKind = "billed" | "equivalent" | "expected";

/** One amount spent, in dollars, as the ledger keeps it. */
export interface SpendEntry {
	/** When it was spent, as an ISO timestamp. */
	at: string;
	/** Who was paid or whose plan was used: `claude`, `codex`, `opencode`, `openai`, `cloudflare`. */
	provider: string;
	/** What of the provider's was used: a model, or a product such as `transcription`. */
	service: string;
	kind: SpendKind;
	dollars: number;
	/** The project's slug, task and conversation it was spent for, when one was. */
	project: string | null;
	task: string | null;
	conversation: string | null;
	/** For an amount a provider billed: a stable key, so pulling it again adds nothing. */
	ref?: string;
	/** For an amount billed in another currency: what was billed and the rate it was converted at. */
	original?: {
		amount: number;
		currency: string;
		rate: number;
		rateDate: string;
	};
}

/** Totals `entries` as `query` asks, oldest period first, then by provider and service. */
export function totals(
	entries: readonly SpendEntry[],
	query: SpendQuery = {},
): SpendTotal[] {
	const rows = new Map<string, SpendTotal>();
	for (const entry of entries) {
		if (
			(query.since !== undefined && entry.at < query.since) ||
			(query.until !== undefined && entry.at >= query.until) ||
			(query.provider !== undefined && entry.provider !== query.provider) ||
			(query.project !== undefined && entry.project !== query.project) ||
			(query.task !== undefined && entry.task !== query.task)
		) {
			continue;
		}
		const provider = query.by === undefined ? null : entry.provider;
		const service = query.by === "service" ? entry.service : null;
		const period =
			query.per === undefined ? null : periodStart(entry.at, query.per);
		const key = JSON.stringify([period, provider, service]);
		let row = rows.get(key);
		if (row === undefined) {
			row = {
				provider,
				service,
				period,
				billed: 0,
				equivalent: 0,
				expected: 0,
			};
			rows.set(key, row);
		}
		row[entry.kind] += entry.dollars;
	}
	return [...rows.values()].sort(
		(one, other) =>
			(one.period ?? "").localeCompare(other.period ?? "") ||
			(one.provider ?? "").localeCompare(other.provider ?? "") ||
			(one.service ?? "").localeCompare(other.service ?? ""),
	);
}

export type Period = "day" | "week" | "month";

export interface SpendQuery {
	/** What to total by; unsaid, everything is one row. */
	by?: "provider" | "service";
	/** Split by this span too; unsaid, all time at once. */
	per?: Period;
	/** Entries from this ISO timestamp (inclusive) to `until` (exclusive). */
	since?: string;
	until?: string;
	provider?: string;
	project?: string;
	task?: string;
}

/** One row of totals, the kinds apart. */
export interface SpendTotal {
	provider: string | null;
	service: string | null;
	/** The span's first day (`2026-10-21`, a Monday for a week, the 1st for a month); null for all time. */
	period: string | null;
	billed: number;
	equivalent: number;
	expected: number;
}

/** The start of the span `at` falls in, as a UTC date. */
export function periodStart(at: string, per: Period): string {
	const date = new Date(at);
	if (per === "month") {
		date.setUTCDate(1);
	} else if (per === "week") {
		// Monday on.
		date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
	}
	return date.toISOString().slice(0, 10);
}

import type { SpendTotal } from "@stringsync/splates-server/spend";
import { createContext, useContext } from "react";

/** The currency the Billing page's amounts are in. */
export const Currency = createContext("USD");

/**
 * Formats an amount in the page's currency; with `cents`, a whole amount
 * keeps its `.00` too, so a column of them lines up.
 */
export const useMoney = (cents = false): ((amount: number) => string) => {
	const currency = useContext(Currency);
	return (amount) => money(amount, currency, cents);
};

/** `2026-10-21` as `Oct 21`. */
export const shortDay = (day: string): string =>
	new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

const DAY = 86_400_000;

/** A range the Billing page steps through, a whole one at a time. */
export type Span = "day" | "week" | "month";

/** The UTC day `at` falls in, as `2026-10-21`, as the ledger's days are. */
export const dayOf = (at: number): string =>
	new Date(at).toISOString().slice(0, 10);

/**
 * The `span` ending today at `now`, or `back` spans before it, as ISO
 * timestamps, `until` exclusive: a week is the seven days to its last, a
 * month its calendar month, whole once it is past.
 */
export function spanOf(
	span: Span,
	now: number,
	back = 0,
): { since: string; until: string } {
	const today = Date.parse(dayOf(now));
	if (span === "month") {
		const date = new Date(today);
		const month = date.getUTCMonth() - back;
		const first = Date.UTC(date.getUTCFullYear(), month, 1);
		const until =
			back === 0 ? today + DAY : Date.UTC(date.getUTCFullYear(), month + 1, 1);
		return {
			since: new Date(first).toISOString(),
			until: new Date(until).toISOString(),
		};
	}
	const days = span === "day" ? 1 : 7;
	const until = today + DAY - back * days * DAY;
	return {
		since: new Date(until - days * DAY).toISOString(),
		until: new Date(until).toISOString(),
	};
}

/** What the page calls `spanOf(span, now, back)`: Today, Yesterday, Oct 14 to Oct 20, September 2026. */
export function spanTitle(span: Span, now: number, back: number): string {
	if (back === 0) {
		return { day: "Today", week: "7 days", month: "This month" }[span];
	}
	const { since, until } = spanOf(span, now, back);
	if (span === "month") {
		return new Date(since).toLocaleDateString("en-US", {
			month: "long",
			year: "numeric",
			timeZone: "UTC",
		});
	}
	if (span === "day") {
		return back === 1 ? "Yesterday" : shortDay(since.slice(0, 10));
	}
	return `${shortDay(since.slice(0, 10))} to ${shortDay(dayOf(Date.parse(until) - DAY))}`;
}

/** What some spend adds up to, the kinds apart. */
export interface Sum {
	billed: number;
	equivalent: number;
	expected: number;
}

export const sum = (rows: readonly Sum[]): Sum => ({
	billed: rows.reduce((all, row) => all + row.billed, 0),
	equivalent: rows.reduce((all, row) => all + row.equivalent, 0),
	expected: rows.reduce((all, row) => all + row.expected, 0),
});

/**
 * What it comes to on the bill: billed and expected charges, never plan use
 * priced at API list prices, which the plans' own fees cover.
 */
export const whole = (row: Sum): number => row.billed + row.expected;

/** One provider's spend in the range, with its services, the costliest first. */
export interface ProviderSpend extends Sum {
	provider: string;
	services: SpendTotal[];
}

/**
 * The report's services on the bill grouped by provider, the costliest
 * provider first; a service that only priced plan use is left out.
 */
export function byProvider(services: readonly SpendTotal[]): ProviderSpend[] {
	const grouped = new Map<string, SpendTotal[]>();
	for (const row of services.filter((each) => whole(each) > 0)) {
		const provider = row.provider ?? "";
		grouped.set(provider, [...(grouped.get(provider) ?? []), row]);
	}
	return [...grouped]
		.map(([provider, rows]) => ({
			provider,
			services: [...rows].sort((one, other) => whole(other) - whole(one)),
			...sum(rows),
		}))
		.sort((one, other) => whole(other) - whole(one));
}

/** One day of the chart: each provider's spend that day, none where it spent nothing. */
export interface SpendDay {
	day: string;
	providers: { provider: string; amount: number }[];
	total: number;
}

/**
 * Every UTC day from `since` up to `until` (exclusive), each with what the
 * report's `days` spent on it, so a day nothing was spent still has its place.
 */
export function everyDay(
	days: readonly SpendTotal[],
	since: string,
	until: string,
): SpendDay[] {
	const filled: SpendDay[] = [];
	for (let at = Date.parse(since); at < Date.parse(until); at += DAY) {
		const day = new Date(at).toISOString().slice(0, 10);
		const providers = days
			.filter((row) => row.period === day && whole(row) > 0)
			.map((row) => ({ provider: row.provider ?? "", amount: whole(row) }));
		filled.push({
			day,
			providers,
			total: providers.reduce((all, each) => all + each.amount, 0),
		});
	}
	return filled;
}

/**
 * What this month will come to at the pace so far: `spent` from the month's
 * start to `now`, stretched over the whole month. None in its first day,
 * when a few hours say little of a month.
 */
export function projected(spent: number, now: number): number | null {
	const date = new Date(now);
	const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
	const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
	const elapsed = now - start;
	return elapsed < DAY ? null : (spent * (end - start)) / elapsed;
}

/** The last day of the month `now` falls in, as `Oct 31`. */
export function monthEnd(now: number): string {
	const date = new Date(now);
	const last = new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
	);
	return last.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/**
 * Each provider's chart color, fixed by who it is rather than where it ranks,
 * so a range that drops one never repaints the rest: the slots of
 * `--series-1` to `--series-8` in styles.css, and gray past them.
 */
const ORDER = [
	"claude",
	"codex",
	"kimi",
	"opencode",
	"openai",
	"cloudflare",
	"typesafe",
];

export function colorOf(provider: string): string {
	const slot = ORDER.indexOf(provider);
	return slot === -1 ? "var(--muted-foreground)" : `var(--series-${slot + 1})`;
}

const NAMES: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
	kimi: "Kimi",
	opencode: "OpenCode",
	openai: "OpenAI",
	cloudflare: "Cloudflare",
	typesafe: "TypeSafe",
};

/** A provider's name as people write it. */
export const nameOf = (provider: string): string => NAMES[provider] ?? provider;

const money = (amount: number, currency: string, cents: boolean): string =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: cents || !Number.isInteger(amount) ? 2 : 0,
		maximumFractionDigits: 2,
	}).format(amount);

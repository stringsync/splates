import type { SpendTotal } from "@stringsync/splates-server/spend";
import { createContext, useContext } from "react";

/** The currency the Billing page's amounts are in. */
export const Currency = createContext("USD");

const money = (amount: number, currency: string, cents: boolean): string =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: cents || !Number.isInteger(amount) ? 2 : 0,
		maximumFractionDigits: 2,
	}).format(amount);

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

/** What some spend adds up to, the two kinds apart. */
export interface Sum {
	billed: number;
	equivalent: number;
}

export const sum = (rows: readonly Sum[]): Sum => ({
	billed: rows.reduce((all, row) => all + row.billed, 0),
	equivalent: rows.reduce((all, row) => all + row.equivalent, 0),
});

export const whole = (row: Sum): number => row.billed + row.equivalent;

/** One provider's spend in the range, with its services, the costliest first. */
export interface ProviderSpend extends Sum {
	provider: string;
	services: SpendTotal[];
}

/** The report's services grouped by provider, the costliest provider first. */
export function byProvider(services: readonly SpendTotal[]): ProviderSpend[] {
	const grouped = new Map<string, SpendTotal[]>();
	for (const row of services) {
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
	opencode: "OpenCode",
	openai: "OpenAI",
	cloudflare: "Cloudflare",
	typesafe: "TypeSafe",
};

/** A provider's name as people write it. */
export const nameOf = (provider: string): string => NAMES[provider] ?? provider;

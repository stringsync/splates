import {
	antigravityGroupLabel,
	antigravityGroupOf,
	type LimitPeak,
} from "../models";
import type { Plan } from "./plans";
import type { Rates } from "./rates";
import type { Spend } from "./spend";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Each subscription's unused quota over the last `input.days`, ranked by
 * monthly dollars left unused; unpriced plans report percentage unused only.
 */
export async function unusedQuotaReport(
	input: UnusedQuotaInput,
): Promise<UnusedQuotaReport> {
	const nowMs = Date.parse(input.now);
	const sinceMs = nowMs - input.days * DAY_MS;
	const sinceIso = new Date(sinceMs).toISOString();
	const today = input.now.slice(0, 10);

	const convert = async (amount: number, currency: string): Promise<number> => {
		if (
			input.rates === undefined ||
			input.rates.currency === currency ||
			amount === 0
		) {
			return amount;
		}
		try {
			return (await input.rates.convert(amount, currency, today)).dollars;
		} catch {
			return amount;
		}
	};

	const currency = input.rates?.currency ?? "USD";
	const entries = await input.ledger.entries();
	const equivalentByProvider = new Map<string, number>();
	for (const entry of entries) {
		if (
			entry.kind !== "equivalent" ||
			entry.at < sinceIso ||
			entry.at >= input.now
		) {
			continue;
		}
		equivalentByProvider.set(
			entry.provider,
			(equivalentByProvider.get(entry.provider) ?? 0) + entry.dollars,
		);
	}

	const planByProvider = new Map<string, Plan>();
	for (const plan of input.plans) {
		planByProvider.set(plan.provider, plan);
	}

	const providers = new Set<string>([
		...planByProvider.keys(),
		...Object.keys(input.peaks),
	]);

	const rows: UnusedQuotaPlan[] = [];
	for (const provider of providers) {
		const plan = planByProvider.get(provider) ?? null;
		const allPeaks = input.peaks[provider] ?? [];
		const primaryGroups = pickPrimaryPeakGroups(provider, allPeaks);
		const fullMonthlyPrice =
			plan === null
				? null
				: round2(
						await convert(
							plan.amount / Math.max(plan.everyMonths, 1),
							plan.currency,
						),
					);
		const apiEquivalent = round2(
			await convert(equivalentByProvider.get(provider) ?? 0, "USD"),
		);

		for (const primary of primaryGroups) {
			const completed: UnusedQuotaReset[] = [];
			let current: { used: number; resets: string } | null = null;

			for (const item of primary.peaks) {
				const resetsMs = Date.parse(item.resets);
				if (!Number.isFinite(resetsMs)) {
					continue;
				}
				const peak = clamp01(item.peak);
				if (resetsMs <= nowMs) {
					if (resetsMs >= sinceMs) {
						completed.push({
							resets: item.resets,
							peak,
							unused: clamp01(1 - peak),
						});
					}
				} else if (current === null || item.resets > current.resets) {
					current = { used: peak, resets: item.resets };
				}
			}

			// Skip providers with neither a pulled plan nor any observed window.
			if (plan === null && completed.length === 0 && current === null) {
				continue;
			}

			const monthlyPrice =
				fullMonthlyPrice === null
					? null
					: round2(fullMonthlyPrice / primaryGroups.length);

			const avgPeak =
				completed.length === 0
					? null
					: completed.reduce((sum, each) => sum + each.peak, 0) /
						completed.length;
			const maxPeak =
				completed.length === 0
					? null
					: Math.max(...completed.map((each) => each.peak));
			const unusedShare = avgPeak === null ? null : clamp01(1 - avgPeak);
			const unusedMonthly =
				monthlyPrice === null || unusedShare === null
					? null
					: round2(monthlyPrice * unusedShare);
			const tierHint =
				plan !== null && maxPeak !== null && completed.length >= 2
					? tierHintFor(provider, plan.service, maxPeak)
					: null;

			rows.push({
				provider,
				...(primary.group === undefined ? {} : { group: primary.group }),
				plan: plan?.service ?? null,
				monthlyPrice,
				window: primary.window,
				resets: completed,
				current,
				avgPeak,
				maxPeak,
				unusedShare,
				unusedMonthly,
				tierHint,
				apiEquivalent,
			});
		}
	}

	rows.sort(comparePlans);

	let totalUnusedMonthly = 0;
	let totalPricedMonthly = 0;
	const pricedProviders = new Set<string>();
	for (const row of rows) {
		if (row.monthlyPrice !== null && row.unusedMonthly !== null) {
			totalUnusedMonthly += row.unusedMonthly;
			totalPricedMonthly += row.monthlyPrice;
			pricedProviders.add(row.provider);
		}
	}

	return {
		days: input.days,
		currency,
		totalUnusedMonthly: round2(totalUnusedMonthly),
		totalPricedMonthly: round2(totalPricedMonthly),
		pricedPlans: pricedProviders.size,
		plans: rows,
	};
}

/** One completed reset cycle of a subscription's primary quota window. */
export interface UnusedQuotaReset {
	/** When the window reset, as an ISO timestamp. */
	resets: string;
	/** Highest share used in this cycle, 0 to 1. */
	peak: number;
	/** Share left unused at reset, 0 to 1 (`1 - peak`). */
	unused: number;
}

/** Unused quota summary for one subscription / agent plan (or one quota group of it). */
export interface UnusedQuotaPlan {
	/** Provider id (`claude`, `codex`, `kimi`, `antigravity`). */
	provider: string;
	/** Independent quota group label when a provider has several (`Gemini`, `Claude & GPT`). */
	group?: string;
	/** Pulled plan name (`Max 20x plan`, `Pro plan`, etc.), or null when unpriced. */
	plan: string | null;
	/** Monthly list price in the display currency, or null when unpriced. */
	monthlyPrice: number | null;
	/** Primary window tracked (e.g. `seven_day`), or null when none has been observed. */
	window: string | null;
	/** Completed resets within the lookback window, oldest first. */
	resets: UnusedQuotaReset[];
	/** Current in-progress cycle when one is active (`resets > now`), or null. */
	current: { used: number; resets: string } | null;
	/** Average peak used across completed resets (0..1), or null when none completed. */
	avgPeak: number | null;
	/** Highest peak used across completed resets (0..1), or null when none completed. */
	maxPeak: number | null;
	/** Average unused share (`1 - avgPeak`, 0..1), or null when none completed. */
	unusedShare: number | null;
	/** Estimated monthly amount left unused, or null when unpriced or no completed resets. */
	unusedMonthly: number | null;
	/** Lower-tier hint when peak usage stays under a cheaper known tier, or null. */
	tierHint: string | null;
	/** Plan use priced at API list prices over the lookback period, in display currency. */
	apiEquivalent: number;
}

/** Ranked unused subscription quota across tracked plans over a lookback span. */
export interface UnusedQuotaReport {
	/** Lookback span in days (`28` for 4 weeks, `90` for 90 days). */
	days: number;
	currency: string;
	/** Sum of `unusedMonthly` across priced plans with completed resets. */
	totalUnusedMonthly: number;
	/** Sum of `monthlyPrice` across priced plans with completed resets. */
	totalPricedMonthly: number;
	/** Number of priced plans included in the headline total. */
	pricedPlans: number;
	/** Plans ranked by `unusedMonthly` desc, then `unusedShare` desc, then tracking plans. */
	plans: UnusedQuotaPlan[];
}

export interface UnusedQuotaInput {
	days: number;
	now: string;
	plans: readonly Plan[];
	peaks: Record<string, LimitPeak[]>;
	ledger: Spend;
	rates?: Rates;
}

/**
 * Picks the primary recurring cap window(s) for `provider` (preferring the
 * overall weekly cap over 5-hour burst or model-specific sub-caps).
 * Antigravity's independent weekly quota groups stay separate.
 */
function pickPrimaryPeakGroups(
	provider: string,
	peaks: readonly LimitPeak[],
): { group?: string; window: string | null; peaks: LimitPeak[] }[] {
	if (peaks.length === 0) {
		return [{ window: null, peaks: [] }];
	}
	if (provider === "claude") {
		const overall = peaks.filter((each) => each.window === "seven_day");
		if (overall.length > 0) {
			return [{ window: "seven_day", peaks: overall }];
		}
	}
	if (provider === "antigravity") {
		const weekly = peaks.filter(
			(each) => (windowMs(each.window) ?? 0) >= 7 * DAY_MS,
		);
		if (weekly.length > 0) {
			const byWindow = new Map<string, LimitPeak[]>();
			for (const item of weekly) {
				const existing = byWindow.get(item.window);
				if (existing === undefined) {
					byWindow.set(item.window, [item]);
				} else {
					existing.push(item);
				}
			}
			const entries = [...byWindow.entries()].sort(([one], [other]) =>
				one.localeCompare(other),
			);
			return entries.map(([window, items]) => ({
				group: antigravityGroupLabel(antigravityGroupOf(window)),
				window,
				peaks: items.toSorted((one, other) =>
					one.resets.localeCompare(other.resets),
				),
			}));
		}
	}
	const windows = [...new Set(peaks.map((each) => each.window))];
	const ranked = windows.sort((one, other) => {
		const lenDiff = (windowMs(other) ?? 0) - (windowMs(one) ?? 0);
		if (lenDiff !== 0) {
			return lenDiff;
		}
		return one.localeCompare(other);
	});
	const chosen = ranked[0] ?? null;
	return [
		{
			window: chosen,
			peaks:
				chosen === null ? [] : peaks.filter((each) => each.window === chosen),
		},
	];
}

function windowMs(window: string): number | null {
	if (window === "five_hour" || / · Five Hour$/i.test(window)) {
		return 5 * HOUR_MS;
	}
	if (window.startsWith("seven_day") || / · Weekly$/i.test(window)) {
		return 7 * DAY_MS;
	}
	if (window === "month") {
		return 30 * DAY_MS;
	}
	const minutes = Number(/^(\d+)_minutes$/.exec(window)?.[1]);
	return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : null;
}

/**
 * Conservative lower-tier hint when a plan's highest observed weekly peak
 * stays within a cheaper known tier's relative capacity.
 */
function tierHintFor(
	provider: string,
	plan: string,
	maxPeak: number,
): string | null {
	if (provider === "claude") {
		if (plan === "Max 20x plan" && maxPeak <= 0.25) {
			return "Peak fits Max 5x ($100)";
		}
		if (plan === "Max 5x plan" && maxPeak <= 0.2) {
			return "Peak fits Pro ($20)";
		}
	}
	if (provider === "codex") {
		if (plan === "Pro plan") {
			if (maxPeak <= 0.1) {
				return "Peak fits Plus ($20)";
			}
			if (maxPeak <= 0.5) {
				return "Peak fits Pro Lite ($100)";
			}
		}
		if (plan === "Pro Lite plan" && maxPeak <= 0.2) {
			return "Peak fits Plus ($20)";
		}
	}
	return null;
}

function comparePlans(one: UnusedQuotaPlan, other: UnusedQuotaPlan): number {
	const oneDollars = one.unusedMonthly ?? -1;
	const otherDollars = other.unusedMonthly ?? -1;
	if (oneDollars !== otherDollars) {
		return otherDollars - oneDollars;
	}
	const oneShare = one.unusedShare ?? -1;
	const otherShare = other.unusedShare ?? -1;
	if (oneShare !== otherShare) {
		return otherShare - oneShare;
	}
	return (
		one.provider.localeCompare(other.provider) ||
		(one.group ?? "").localeCompare(other.group ?? "")
	);
}

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
const round2 = (value: number): number => Math.round(value * 100) / 100;

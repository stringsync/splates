import type { Fs } from "webappwiz/system";
import type { Agent, Limit } from "../conversations";

/** Where Kimi Code asks for its plan's usage when its config names none. */
const BASE_URL = "https://api.kimi.com/coding/v1";

/** How long Kimi's usage endpoint gets to answer. */
const WAIT_MS = 8_000;

/** Kimi's windows, by what Claude calls those it has too. */
const WINDOWS: [string, string][] = [
	["limit_5h", "five_hour"],
	["limit_7d", "seven_day"],
	// `limit_month_code` is only Kimi Code's share of this one, not a limit.
	["limit_month_total", "month"],
];

/** Whether `agent` is Kimi Code, whose limits only {@link kimiLimits} reads. */
export function isKimi(agent: Agent): boolean {
	// A `kimi` path, alone or in the roster's `sh -c`.
	return agent.argv.some((each) => /(^|\/)kimi($|["\s])/.test(each));
}

/**
 * Kimi Code's plan windows, as its own `/usage` shows them: none when Kimi
 * is signed out, its sign-in has expired since it last ran, or the endpoint
 * will not say.
 */
export async function kimiLimits(deps: {
	fs: Fs;
	now: () => number;
	/** `~/.kimi-code`, or `KIMI_CODE_HOME`. */
	home: string;
	/** `KIMI_CODE_BASE_URL`, which Kimi reads before its config. */
	baseUrl?: string;
	/** A test's stands in for the network. */
	fetcher?: typeof fetch;
}): Promise<Limit[]> {
	// The sign-in is Kimi's to refresh, which rotates it: one expired waits
	// for Kimi to run again.
	const token = await accessToken(deps);
	if (token === null) {
		return [];
	}
	const base = deps.baseUrl ?? (await configuredBase(deps)) ?? BASE_URL;
	try {
		const res = await (deps.fetcher ?? fetch)(
			`${base.replace(/\/+$/, "")}/usages`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
				signal: AbortSignal.timeout(WAIT_MS),
			},
		);
		if (!res.ok) {
			return [];
		}
		return limitsIn(await res.json(), new Date(deps.now()).toISOString());
	} catch {
		return [];
	}
}

/** A Kimi membership's next renewal at its monthly list price. */
export interface KimiSubscription {
	service: string;
	since: string;
	amount: number;
	currency: string;
	everyMonths: number;
}

/** Kimi's plan and next renewal at its monthly list price; null for anything it cannot confirm. */
export async function kimiSubscription(deps: {
	fs: Fs;
	now: () => number;
	home: string;
	baseUrl?: string;
	fetcher?: typeof fetch;
}): Promise<KimiSubscription | null> {
	const token = await accessToken(deps);
	if (token === null) {
		return null;
	}
	const base = deps.baseUrl ?? (await configuredBase(deps)) ?? BASE_URL;
	const currency = currencyOf(base);
	return currency === null
		? null
		: listedSubscription(deps, token, base, currency);
}

/** Monthly list prices from Kimi's international and China membership pages. */
const MONTHLY: Record<string, Record<string, number>> = {
	USD: { Plus: 19, Pro: 39, Max: 99, Ultra: 199 },
	CNY: { Plus: 99, Pro: 199, Max: 699, Ultra: 1399 },
};

/** A CLI login's plan at its monthly list price. */
async function listedSubscription(
	deps: {
		now: () => number;
		baseUrl?: string;
		fetcher?: typeof fetch;
	},
	token: string,
	base: string,
	currency: string,
): Promise<KimiSubscription | null> {
	const ask = async (path: string): Promise<unknown> => {
		const res = await (deps.fetcher ?? fetch)(
			`${base.replace(/\/+$/, "")}/${path}`,
			{
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/json",
				},
				signal: AbortSignal.timeout(WAIT_MS),
			},
		);
		return res.ok ? await res.json() : null;
	};
	try {
		const [profile, usage] = await Promise.all([ask("me"), ask("usages")]);
		const name = record(profile)?.user_level_name;
		const reset = record(
			record(record(usage)?.usages)?.limit_month_total,
		)?.reset_time;
		const amount = typeof name === "string" ? MONTHLY[currency]?.[name] : null;
		return amount !== undefined &&
			amount !== null &&
			typeof reset === "string" &&
			Number.isFinite(Date.parse(reset))
			? {
					service: `${name} plan`,
					since: new Date(reset).toISOString(),
					amount,
					currency,
					everyMonths: 1,
				}
			: null;
	} catch {
		return null;
	}
}

function currencyOf(base: string): string | null {
	try {
		const host = new URL(base).hostname;
		return host === "api.kimi.ai"
			? "USD"
			: host === "api.kimi.com"
				? "CNY"
				: null;
	} catch {
		return null;
	}
}

/** The windows in a `/usages` answer that say how much is used and when it resets. */
export function limitsIn(payload: unknown, at: string): Limit[] {
	const usages = record(record(payload)?.usages);
	return WINDOWS.flatMap(([key, window]) => {
		const entry = record(usages?.[key]);
		const used = Number(entry?.used_ratio);
		const resets = entry?.reset_time;
		return entry === null ||
			!Number.isFinite(used) ||
			typeof resets !== "string" ||
			!Number.isFinite(Date.parse(resets))
			? []
			: [{ window, used, resets: new Date(resets).toISOString(), at }];
	});
}

/** Kimi's cached access token, while it is still good; null otherwise. */
async function accessToken(deps: {
	fs: Fs;
	now: () => number;
	home: string;
}): Promise<string | null> {
	try {
		const saved = record(
			JSON.parse(await deps.fs.read(`${deps.home}/credentials/kimi-code.json`)),
		);
		const token = saved?.access_token;
		const expires = saved?.expires_at;
		return typeof token === "string" &&
			token.length > 0 &&
			typeof expires === "number" &&
			expires * 1000 > deps.now()
			? token
			: null;
	} catch {
		return null;
	}
}

/** The base URL Kimi's config gives its own plan's provider, as a global sign-in's `api.kimi.ai`. */
async function configuredBase(deps: {
	fs: Fs;
	home: string;
}): Promise<string | null> {
	try {
		const config = record(
			Bun.TOML.parse(await deps.fs.read(`${deps.home}/config.toml`)),
		);
		const url = record(
			record(config?.providers)?.["managed:kimi-code"],
		)?.base_url;
		return typeof url === "string" && url.length > 0 ? url : null;
	} catch {
		return null;
	}
}

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: null;
}

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

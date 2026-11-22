import { fail } from "../exit";
import { scheduleOf } from "../hooks/schedule";

/** `30s`, `30m`, `2h`, `1d` as milliseconds, refusing what will not read. */
export function durationMs(text: string): number {
	const seconds = /^(\d+)\s*s$/.exec(text.trim());
	if (seconds !== null) {
		return Number(seconds[1]) * 1000;
	}
	return scheduleOf({ every: text }).nextAfter(0);
}

/** Converts a duration or future calendar date into a removal deadline. */
export function expirationOf(text: string, now: number): string {
	const value = text.trim();
	const at = /^\d+\s*[smhd]$/.test(value)
		? now + durationMs(value)
		: /^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)
			? Date.parse(value)
			: Number.NaN;
	if (!Number.isFinite(at) || at <= now || at > 8.64e15) {
		fail(
			"usage",
			"expiration must be a positive duration (2h, 7d) or a future ISO date/time with timezone",
			{},
		);
	}
	return new Date(at).toISOString();
}

/**
 * Reads `--since` as an ISO time: give a duration (`30m`, `2h`, `1d`) to
 * mean that long before `now`, or an ISO time as it is.
 */
export function sinceOf(text: string, now: number): string {
	if (/^\d+\s*[mhd]$/.test(text.trim())) {
		return new Date(now - durationMs(text)).toISOString();
	}
	const at = Date.parse(text);
	if (Number.isNaN(at)) {
		fail(
			"usage",
			`'${text}' is no time: give how long ago (30m, 2h, 1d) or an ISO time`,
			{ since: text },
		);
	}
	return new Date(at).toISOString();
}

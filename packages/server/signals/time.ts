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

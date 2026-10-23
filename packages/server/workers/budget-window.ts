import { Duration } from "webappwiz/time";
import type { WorkerLimit } from "./limits";

/**
 * When `limit`'s window began, in local time: the hour, the day, or the
 * month, as scry's `windowStart` counts a day and a month.
 */
export function windowStart(limit: WorkerLimit, now: number): number {
	const date = new Date(now);
	if (limit === "hour") {
		date.setMinutes(0, 0, 0);
		return date.getTime();
	}
	date.setHours(0, 0, 0, 0);
	if (limit === "month") {
		date.setDate(1);
	}
	return date.getTime();
}

/** A span, like `1d`, `24h` or `2w`, as a duration, as scry's `within` reads one. */
export function span(text: string): Duration {
	const match = /^(\d+)([hdw])$/.exec(text);
	if (match === null) {
		throw new Error(
			`expected hours, days or weeks, like "24h", "7d" or "2w", got "${text}"`,
		);
	}
	const count = Number(match[1]);
	return match[2] === "h"
		? Duration.hrs(count)
		: Duration.days(match[2] === "d" ? count : count * 7);
}

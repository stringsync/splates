import { fail } from "../exit";
import { scheduleOf } from "../hooks/schedule";

const DAY = 86_400_000;
/** A persisted clock's resolved meaning, shared by cards and the runner. */
export interface SignalClock {
	name: string;
	meaning: string;
	tz: string;
	next: string | null;
	startedAt: string;
	recurring: boolean;
}

/** A duration in words or compact units; ambiguous units are refused. */
export function clockDuration(text: string): number {
	const match =
		/^(\d+(?:\.\d+)?)\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?|w|weeks?|years?)$/i.exec(
			text.trim(),
		);
	const units: Record<string, number> = {
		s: 1000,
		sec: 1000,
		second: 1000,
		m: 60000,
		min: 60000,
		minute: 60000,
		h: 3600000,
		hr: 3600000,
		hour: 3600000,
		d: DAY,
		day: DAY,
		w: 7 * DAY,
		week: 7 * DAY,
		year: 365 * DAY,
	};
	const rawUnit = match?.[2]?.toLowerCase() ?? "";
	const unit = rawUnit.length === 1 ? rawUnit : rawUnit.replace(/s$/, "");
	const ms = Number(match?.[1]) * (units[unit] ?? NaN);
	if (!Number.isFinite(ms) || ms < 1000 || ms > 365 * DAY) {
		fail(
			"usage",
			`Cannot read '${text}': use a delay from 1 second to 1 year, as "2 days"`,
			{},
		);
	}
	return ms;
}

/** Local calendar fields in a named zone. */
export function zoned(at: number, tz: string): Date {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: tz,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const numberOf = (key: string) =>
		Number(parts.find((part) => part.type === key)?.value);
	return new Date(
		Date.UTC(
			numberOf("year"),
			numberOf("month") - 1,
			numberOf("day"),
			numberOf("hour"),
			numberOf("minute"),
			numberOf("second"),
		),
	);
}

/** Resolves a local wall time; nonexistent DST times are refused. */
function localInstant(local: Date, tz: string): number | null {
	let at = local.getTime();
	for (let i = 0; i < 4; i++) {
		at += local.getTime() - zoned(at, tz).getTime();
	}
	return zoned(at, tz).getTime() === local.getTime() ? at : null;
}
function instant(local: Date, tz: string): number {
	const at = localInstant(local, tz);
	if (at === null) {
		fail("usage", "That local time does not exist in this time zone", {});
	}
	return at;
}

function timeOf(text: string): string {
	const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(text.trim());
	let hour = Number(match?.[1]);
	const min = Number(match?.[2] ?? 0);
	if (!match || min > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) {
		fail("usage", `Cannot read time '${text}': use 9am or 09:00`, {});
	}
	if (match[3]) {
		hour = (hour % 12) + (match[3].toLowerCase() === "pm" ? 12 : 0);
	}
	return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function atOf(text: string, now: number, tz: string): number {
	if (/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/i.test(text)) {
		const at = Date.parse(text);
		if (Number.isFinite(at)) {
			return at;
		}
	}
	const local = zoned(now, tz);
	local.setUTCMilliseconds(0);
	local.setUTCSeconds(0);
	const date = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](.+))?$/.exec(text);
	const relative =
		/^(today|tomorrow|next (sunday|monday|tuesday|wednesday|thursday|friday|saturday))(?:\s+(.+))?$/i.exec(
			text,
		);
	let time = text;
	if (date) {
		local.setUTCFullYear(Number(date[1]), Number(date[2]) - 1, Number(date[3]));
		if (
			local.getUTCFullYear() !== Number(date[1]) ||
			local.getUTCMonth() !== Number(date[2]) - 1 ||
			local.getUTCDate() !== Number(date[3])
		) {
			fail("usage", `Invalid date '${text}'`, {});
		}
		time = date[4] ?? "00:00";
	} else if (relative) {
		let days = relative[1]?.toLowerCase() === "tomorrow" ? 1 : 0;
		if (relative[2]) {
			const weekday = [
				"sunday",
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
			].indexOf(relative[2].toLowerCase());
			days = (weekday - local.getUTCDay() + 7) % 7 || 7;
		}
		local.setUTCDate(local.getUTCDate() + days);
		time = relative[3] ?? "00:00";
	}
	const [hours, match] = timeOf(time).split(":").map(Number);
	local.setUTCHours(hours ?? 0, match ?? 0, 0, 0);
	let at = instant(local, tz);
	if (!date && !relative && at <= now) {
		local.setUTCDate(local.getUTCDate() + 1);
		at = instant(local, tz);
	}
	return at;
}

/** Normalizes clock arguments before constructing their canonical identity. */
export function normalizeClock(
	fn: string,
	args: Record<string, string | number | boolean>,
	now = Date.now(),
): void {
	if (!fn.startsWith("clock.")) {
		return;
	}
	const tz = String(
		args.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	);
	try {
		new Intl.DateTimeFormat("en", { timeZone: tz });
	} catch {
		fail("usage", `Unknown time zone '${tz}'`, {});
	}
	args.tz = new Intl.DateTimeFormat("en", {
		timeZone: tz,
	}).resolvedOptions().timeZone;
	if (fn === "clock.in") {
		args.after = `${clockDuration(String(args.after)) / 1000}s`;
	}
	if (fn === "clock.interval") {
		args.interval = `${clockDuration(String(args.interval)) / 1000}s`;
		if (args.at !== undefined) {
			args.at = timeOf(String(args.at));
			if (clockDuration(String(args.interval)) % DAY !== 0) {
				fail("usage", "An interval with 'at' needs a whole number of days", {});
			}
		}
	}
	if (fn === "clock.at") {
		args.time = new Date(atOf(String(args.time), now, tz)).toISOString();
	}
	if (fn === "clock.cron") {
		args.expr = String(args.expr).trim().replace(/\s+/g, " ");
		scheduleOf({ cron: String(args.expr) }, tz);
	}
}

/** Computes the next firing strictly after `after`, anchored at the original start. */
export function clockNext(
	fn: string,
	args: Record<string, string | number | boolean>,
	start: number,
	after: number,
): number {
	const tz = String(args.tz);
	if (fn === "clock.in") {
		return start + clockDuration(String(args.after));
	}
	if (fn === "clock.at") {
		return Date.parse(String(args.time));
	}
	if (fn === "clock.cron") {
		return scheduleOf({ cron: String(args.expr) }, tz).nextAfter(after);
	}
	const interval = clockDuration(String(args.interval));
	if (args.at === undefined) {
		return start + (Math.floor((after - start) / interval) + 1) * interval;
	}
	const local = zoned(start, tz);
	const [hours, match] = String(args.at).split(":").map(Number);
	local.setUTCHours(hours ?? 0, match ?? 0, 0, 0);
	const elapsed = zoned(after, tz).getTime() - local.getTime();
	local.setUTCDate(
		local.getUTCDate() +
			Math.max(0, Math.floor(elapsed / interval)) * (interval / DAY),
	);
	// A daily wall time can disappear on a DST jump; skip that occurrence.
	for (let count = 0; count < 367; count++) {
		const next = localInstant(local, tz);
		if (next !== null && next > after) {
			return next;
		}
		local.setUTCDate(local.getUTCDate() + interval / DAY);
	}
	return Number.POSITIVE_INFINITY;
}

/** Builds the initial durable schedule from a normalized call. */
export function newClock(
	name: string,
	fn: string,
	args: Record<string, string | number | boolean>,
	now: number,
): SignalClock {
	const duration = (text: string) => {
		const seconds = clockDuration(text) / 1000;
		return seconds % 86400 === 0
			? `${seconds / 86400} days`
			: seconds % 3600 === 0
				? `${seconds / 3600} hours`
				: seconds % 60 === 0
					? `${seconds / 60} minutes`
					: `${seconds} seconds`;
	};
	const meaning =
		fn === "clock.in"
			? `Once after ${duration(String(args.after))}`
			: fn === "clock.at"
				? "Once at the scheduled time"
				: fn === "clock.interval"
					? `Every ${duration(String(args.interval))}${args.at === undefined ? "" : ` at ${args.at}`}`
					: `Cron ${args.expr}`;
	const next = clockNext(fn, args, now, now);
	if (!Number.isFinite(next) || next < now) {
		fail("usage", "The clock needs a future firing", {});
	}
	return {
		name,
		meaning,
		tz: String(args.tz),
		next: new Date(next).toISOString(),
		startedAt: new Date(now).toISOString(),
		recurring: fn === "clock.interval" || fn === "clock.cron",
	};
}

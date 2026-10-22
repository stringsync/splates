import { Duration } from "webappwiz/time";
import type { JobSetting } from "./job-size";

/**
 * How long a heavy job may run when its project's `splates.config.ts` sets no
 * `job.timeout`: a whole test run here takes about a minute, so this catches
 * only a command that hangs, which would otherwise hold its runner or slot.
 */
export const DEFAULT_JOB_TIMEOUT = Duration.mins(30);

/** `text` as a length of time: `30`, `30m` and `30min` are minutes, `90s`, `2h`. Null for anything else. */
export function parseTimeout(text: string): Duration | null {
	const match = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(text);
	const scale = SPANS[match?.[2]?.toLowerCase() ?? "?"];
	if (match?.[1] === undefined || scale === undefined) {
		return null;
	}
	const ms = Number(match[1]) * scale;
	return ms > 0 ? Duration.ms(ms) : null;
}

/**
 * How long a job may run: `override` when given, else `setting`'s, else
 * the default. Throws on a timeout that is no length of time.
 */
export function jobTimeout(
	setting: JobSetting | undefined,
	override?: Duration,
): Duration {
	const timeout = setting?.timeout;
	const set =
		typeof timeout === "string"
			? (parseTimeout(timeout) ??
				invalid(`splates.config.ts sets job.timeout to "${timeout}"`))
			: timeout === undefined
				? undefined
				: Duration.mins(timeout);
	return override ?? set ?? DEFAULT_JOB_TIMEOUT;
}

const SPANS: Record<string, number> = {
	"": 60_000,
	s: 1000,
	sec: 1000,
	secs: 1000,
	m: 60_000,
	min: 60_000,
	mins: 60_000,
	h: 3_600_000,
	hr: 3_600_000,
	hrs: 3_600_000,
};

function invalid(what: string): never {
	throw new Error(`${what}: name a length such as "30m" or "90s"`);
}

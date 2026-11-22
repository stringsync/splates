const PREFIX = "signal ";

/** How a signal wait goes among a thread's cards, placed by the time it began. */
export function signalId(id: string): string {
	return `${PREFIX}${id}`;
}

export function isSignalId(id: string): boolean {
	return id.startsWith(PREFIX);
}

/** The wait a card id names. */
export function waitOf(id: string): string {
	return id.slice(PREFIX.length);
}

/** How long is left until `until`, as `2d`, `1h 52m`, `5h`, `40m` or `under a minute`. */
export function timeLeft(until: string, now: number): string {
	const minutes = Math.ceil((Date.parse(until) - now) / 60_000);
	if (minutes <= 0) {
		return "under a minute";
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours >= 24) {
		return `${Math.floor(hours / 24)}d`;
	}
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** A live countdown to `until`, as `6d 03:12:09`, or `03:12:09` inside a day; `00:00:00` once past. */
export function countdown(until: string, now: number): string {
	const total = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
	const days = Math.floor(total / 86_400);
	const pad = (part: number) => String(part).padStart(2, "0");
	const clock = `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
	return days > 0 ? `${days}d ${clock}` : clock;
}

const PROBE = "probe ";

/** How a signal probe goes among a thread's cards, placed by the time it started. */
export function probeId(name: string, startedAt: string): string {
	return `${PROBE}${startedAt} ${name}`;
}

export function isProbeId(id: string): boolean {
	return id.startsWith(PROBE);
}

/** How long ago `at` was, as `now`, `40s ago`, `5m ago` or `2h ago`. */
export function ago(at: string, now: number): string {
	const seconds = Math.floor((now - Date.parse(at)) / 1000);
	if (seconds < 5) {
		return "now";
	}
	if (seconds < 60) {
		return `${seconds}s ago`;
	}
	const minutes = Math.floor(seconds / 60);
	return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

/** A probe's gap between runs, as `30s`, `5m` or `1h`. */
export function everyOf(ms: number): string {
	if (ms < 60_000) {
		return `${Math.round(ms / 1000)}s`;
	}
	if (ms < 3_600_000) {
		return `${Math.round(ms / 60_000)}m`;
	}
	return `${Math.round(ms / 3_600_000)}h`;
}

/** Whether a run says its check is broken: any exit but 0 (holds) and 1 (not yet). */
export function errored(run: { exit: number }): boolean {
	return run.exit !== 0 && run.exit !== 1;
}

/** How many of the latest runs in a row errored. */
export function errorsInARow(runs: readonly { exit: number }[]): number {
	const last = runs.findLastIndex((run) => !errored(run));
	return runs.length - 1 - last;
}

/** Whether a probe and a wait on the same signal were on at the same time. */
export function overlaps(
	probe: { name: string; startedAt: string; endedAt?: string },
	wait: { name: string; startedAt: string; endedAt?: string },
): boolean {
	const end = (at: string | undefined): number =>
		at === undefined ? Number.POSITIVE_INFINITY : Date.parse(at);
	return (
		probe.name === wait.name &&
		Date.parse(probe.startedAt) <= end(wait.endedAt) &&
		Date.parse(wait.startedAt) <= end(probe.endedAt)
	);
}

/** The probe a wait's card shows: the latest started on its signal while it was on. */
export function probeFor<
	P extends { name: string; startedAt: string; endedAt?: string },
>(
	wait: { name: string; startedAt: string; endedAt?: string },
	probes: readonly P[],
): P | null {
	return (
		probes
			.filter((probe) => overlaps(probe, wait))
			.sort((one, two) => Date.parse(one.startedAt) - Date.parse(two.startedAt))
			.at(-1) ?? null
	);
}

/** How long from `from` to `to`, as `40s`, `14m`, `2h` or `3d`. */
export function lasted(from: string, to: string): string {
	const seconds = Math.max(
		0,
		Math.round((Date.parse(to) - Date.parse(from)) / 1000),
	);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

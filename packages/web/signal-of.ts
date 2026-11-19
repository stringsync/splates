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

/** How long is left until `until`, as `5h`, `40m` or `under a minute`. */
export function timeLeft(until: string, now: number): string {
	const minutes = Math.ceil((Date.parse(until) - now) / 60_000);
	if (minutes <= 0) {
		return "under a minute";
	}
	if (minutes < 60) {
		return `${minutes}m`;
	}
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
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

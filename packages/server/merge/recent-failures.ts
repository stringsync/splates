import type { Event, Journal } from "../records";

/** How far back a failed gate still says which files to run first. */
export const RECENT_FAILURE_MS = 3 * 60 * 60 * 1000;

/** The most log entries read back for it. */
const SCAN = 500;

/**
 * The test files that failed a merge's gate within `RECENT_FAILURE_MS` of
 * `now`, most recent first, once each. A file fails gate after gate until a
 * fix lands, so the next gate runs these before the rest of the suite.
 */
export async function recentFailedFiles(
	journal: Journal | undefined,
	now: number = Date.now(),
): Promise<string[]> {
	const entries = (await journal?.tail(SCAN).catch(() => [])) ?? [];
	return recentFailedFilesOf(entries, now);
}

export function recentFailedFilesOf(entries: Event[], now: number): string[] {
	const files = new Set<string>();
	for (const entry of entries.toReversed()) {
		if (
			entry.action !== "merge" ||
			now - Date.parse(entry.at) > RECENT_FAILURE_MS
		) {
			continue;
		}
		for (const test of entry.failedTests ?? []) {
			if (test.file) {
				files.add(test.file);
			}
		}
	}
	return [...files];
}

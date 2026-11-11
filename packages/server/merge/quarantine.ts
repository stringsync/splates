import type { Event, Journal } from "../records";
import type { FailedTest } from "../tasks";

/** How far back a flake still counts toward quarantining its test. */
export const QUARANTINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** How many merges a test flakes in, within the window, before it is quarantined. */
export const QUARANTINE_AFTER = 2;

/** The most log entries read back for it. */
const SCAN = 5000;

/** A test whose failures no longer refuse a merge. */
export interface QuarantinedTest {
	name: string;
	file?: string;
	/** In how many merges it flaked within the window. */
	flakes: number;
	/** When it last flaked, as an ISO time. */
	last: string;
}

/** What names a test across merges: its file, when the report gave one, and its name. */
export function testKey(test: Pick<FailedTest, "name" | "file">): string {
	return `${test.file ?? ""}\u0000${test.name}`;
}

/**
 * The tests that flaked, a failure in the gate that passed on a retest, in at
 * least `QUARANTINE_AFTER` merges within `QUARANTINE_WINDOW_MS` of `now`,
 * most recently flaked first.
 */
export function quarantinedOf(
	entries: readonly Event[],
	now: number,
): QuarantinedTest[] {
	const seen = new Map<string, QuarantinedTest>();
	for (const entry of entries) {
		if (
			entry.action !== "merge" ||
			entry.failureAttribution !== "flake" ||
			now - Date.parse(entry.at) > QUARANTINE_WINDOW_MS
		) {
			continue;
		}
		const names = new Set<string>();
		for (const test of entry.failedTests ?? []) {
			const key = testKey(test);
			if (names.has(key)) {
				continue;
			}
			names.add(key);
			const known = seen.get(key);
			const file = test.file;
			seen.set(key, {
				name: test.name,
				...(file === undefined ? {} : { file }),
				flakes: (known?.flakes ?? 0) + 1,
				last:
					known === undefined || entry.at > known.last ? entry.at : known.last,
			});
		}
	}
	return [...seen.values()]
		.filter((test) => test.flakes >= QUARANTINE_AFTER)
		.sort((later, earlier) => earlier.last.localeCompare(later.last));
}

/** `quarantinedOf` the journal's recent entries. */
export async function quarantinedTests(
	journal: Journal,
	now: number = Date.now(),
): Promise<QuarantinedTest[]> {
	const entries = await journal.tail(SCAN).catch(() => []);
	return quarantinedOf(entries, now);
}

/**
 * Whether `failed` is a failure the gate may excuse: it names tests, and
 * every one is quarantined.
 */
export function allQuarantined(
	failed: readonly FailedTest[],
	quarantined: readonly QuarantinedTest[],
): boolean {
	const keys = new Set(quarantined.map(testKey));
	return failed.length > 0 && failed.every((test) => keys.has(testKey(test)));
}

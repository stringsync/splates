import type { Commit } from "./git";
import type { Systems } from "./systems";

/** How many of trunk's latest commits the Systems page looks through. */
export const RECENT_COMMITS = 500;

/** How many of those commits each system lists, newest first. */
export const CHANGES_SHOWN = 10;

/** One commit that changed a system. */
export type Change = Omit<Commit, "files">;

/** What one system is made of on trunk, and how it moved lately. */
export interface SystemChanges {
	/** The system's name. */
	name: string;
	/** How many files trunk tracks in it. */
	files: number;
	/** Its globs that take in no file trunk tracks. */
	unmatched: string[];
	/** How many of the commits looked through changed it. */
	changed: number;
	/** The latest of them, up to `CHANGES_SHOWN`, newest first. */
	changes: Change[];
}

/** What the Systems page reads: every system, and how far back it looked. */
export interface SystemsReport {
	systems: SystemChanges[];
	/** When the oldest commit looked through was written, or null for none. */
	since: string | null;
	/** How many commits were looked through. */
	scanned: number;
}

/**
 * How each of `systems` stands in a tree whose tracked files are `files`,
 * and which of `commits`, newest first, changed it.
 */
export function systemsReport(
	systems: Systems,
	files: string[],
	commits: Commit[],
): SystemsReport {
	return {
		systems: systems.all().map((system) => {
			const touching = commits
				.filter((commit) => systems.within(system, commit.files).length > 0)
				.map(({ files: _, ...change }) => change);
			return {
				name: system.name,
				files: systems.within(system, files).length,
				unmatched: systems.unmatched(system, files),
				changed: touching.length,
				changes: touching.slice(0, CHANGES_SHOWN),
			};
		}),
		since: commits.at(-1)?.at ?? null,
		scanned: commits.length,
	};
}

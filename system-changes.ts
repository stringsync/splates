import type { Commit } from "./git";
import type { Systems } from "./systems";

/** How many of trunk's latest commits the Systems page looks through. */
export const RECENT_COMMITS = 500;

/** How many of those commits each system lists, newest first. */
export const CHANGES_SHOWN = 10;

/**
 * How many uncovered files a directory holds before they are split into
 * groups by the first word of their names.
 */
export const SPLIT = 30;

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
	/** How many files trunk tracks that no system covers. */
	uncovered: number;
	/**
	 * Those files as globs: those of several files first, then each lot
	 * changed most lately first.
	 */
	groups: Uncovered[];
}

/** Files no system covers, as one glob a system could be named for. */
export interface Uncovered {
	/** A glob taking in the files, such as `src/upload/*` or `src/upload*`. */
	glob: string;
	/** How many uncovered files it takes in. */
	files: number;
	/** How many of the commits looked through changed one of them. */
	changed: number;
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
		...uncovered(systems, files, commits),
	};
}

/**
 * The files no system covers, grouped and counted, and how many of
 * `commits` changed each group.
 */
function uncovered(
	systems: Systems,
	files: string[],
	commits: Commit[],
): Pick<SystemsReport, "uncovered" | "groups"> {
	const outside = files.filter(
		(file) => systems.touchedBy([file]).length === 0,
	);
	const globOf = groupsOf(outside);
	const groups = new Map<string, Uncovered>();
	for (const file of outside) {
		const glob = globOf.get(file) ?? file;
		const group = groups.get(glob) ?? { glob, files: 0, changed: 0 };
		group.files++;
		groups.set(glob, group);
	}
	for (const commit of commits) {
		const touched = new Set(
			commit.files.flatMap((file) => globOf.get(file) ?? []),
		);
		for (const glob of touched) {
			const group = groups.get(glob);
			if (group !== undefined) {
				group.changed++;
			}
		}
	}
	return {
		uncovered: outside.length,
		// A lone file, however busy, is seldom a system of its own.
		groups: [...groups.values()].sort(
			(one, other) =>
				Number(other.files > 1) - Number(one.files > 1) ||
				other.changed - one.changed ||
				other.files - one.files ||
				one.glob.localeCompare(other.glob),
		),
	};
}

/**
 * Each of `files` with the glob it is grouped under: its directory's `dir/*`,
 * or, in a directory with more than `SPLIT` of them, `dir/word*` for the
 * first word of its name, the way a flat directory's systems are named.
 */
function groupsOf(files: string[]): Map<string, string> {
	const inDir = new Map<string, number>();
	for (const file of files) {
		const dir = dirOf(file);
		inDir.set(dir, (inDir.get(dir) ?? 0) + 1);
	}
	return new Map(
		files.map((file) => {
			const dir = dirOf(file);
			const prefix = dir === "" ? "" : `${dir}/`;
			if ((inDir.get(dir) ?? 0) <= SPLIT) {
				return [file, `${prefix}*`];
			}
			const name = file.slice(prefix.length);
			const [word = name] = /^[^-.]+/.exec(name) ?? [];
			return [file, `${prefix}${word}*`];
		}),
	);
}

function dirOf(file: string): string {
	const slash = file.lastIndexOf("/");
	return slash === -1 ? "" : file.slice(0, slash);
}

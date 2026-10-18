import { existsSync } from "node:fs";
import { symlink } from "node:fs/promises";
import { basename } from "node:path";
import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";

// Everything splates still answers to from when it was arbor, kept for one
// release so projects, machines and webappwiz's `wiz` move over without
// breaking. Dropping this file, `legacy-ps.ts` and what imports them ends it.

/** splates's old name, as its command, its skill and its directories went by. */
export const LEGACY = "arbor";

const NEW_ENV = "SPLATES_";
const OLD_ENV = "ARBOR_";

/** The old name of a `SPLATES_*` variable or cred, or null for any other. */
export function legacyName(name: string): string | null {
	return name.startsWith(NEW_ENV)
		? `${OLD_ENV}${name.slice(NEW_ENV.length)}`
		: null;
}

/** The `SPLATES_*` name of an `ARBOR_*` variable or cred, or null for any other. */
export function renamed(old: string): string | null {
	return old.startsWith(OLD_ENV)
		? `${NEW_ENV}${old.slice(OLD_ENV.length)}`
		: null;
}

/** `arbor.config.ts`, read when `splates.config.ts` is missing. */
const LEGACY_CONFIG_FILE = "arbor.config.ts";

/** `arbor.systems.ts`, read when `splates.systems.ts` is missing. */
const LEGACY_SYSTEMS_FILE = "arbor.systems.ts";

/** A task's notes file in a worktree made before the rename. */
export const LEGACY_PLAN_FILE = "ARBOR.md";

/** The state directory under `.git`, and the home directory's, before the rename. */
export const LEGACY_DIR = "arbor";

/** Says once per process, on stderr, that an old name was used. */
class Warnings {
	readonly #said = new Set<string>();

	once(name: string, instead: string): void {
		if (this.#said.has(name)) {
			return;
		}
		this.#said.add(name);
		process.stderr.write(
			`splates: ${name} is an old name, kept for one more release: use ${instead}\n`,
		);
	}
}

export const legacyWarnings = new Warnings();

/**
 * `next`, or `old` while only the old directory is there: until `splates server`
 * has moved it, every command reads records where arbor left them.
 */
export function unmigrated(next: string, old: string): string {
	return !existsSync(next) && existsSync(old) ? old : next;
}

/** What `moveLegacyDir` works with. */
export interface MoveOptions {
	fs: Fs;
	log: Logger;
	/** Makes `path` a symbolic link to `target`; the real one by default. */
	link?: (target: string, path: string) => Promise<void>;
}

/**
 * Moves arbor's directory `old` to `next` and leaves a link at `old`, so the
 * absolute paths records hold, attachments named in plans, todos and
 * conversations above all, still resolve. Does nothing once moved, or when
 * `next` is already there. Answers whether it moved.
 */
export async function moveLegacyDir(
	old: string,
	next: string,
	{ fs, log, link = symlink }: MoveOptions,
): Promise<boolean> {
	if (
		(await fs.exists(next)) ||
		!(await fs.exists(old)) ||
		(await fs.isSymlink(old))
	) {
		return false;
	}
	try {
		await fs.rename(old, next);
	} catch (error) {
		// Another splates moved it first.
		if (await fs.exists(next)) {
			return false;
		}
		throw error;
	}
	await link(basename(next), old);
	log.info(`moved ${old} to ${next}, left a link behind`);
	return true;
}

/** Renames a worktree's `ARBOR.md` to `planFile`, unless it has one already. */
export async function movePlan(
	tree: string,
	planFile: string,
	fs: Fs,
): Promise<void> {
	const old = `${tree}/${LEGACY_PLAN_FILE}`;
	const next = `${tree}/${planFile}`;
	if ((await fs.exists(old)) && !(await fs.exists(next))) {
		await fs.rename(old, next);
	}
}

/**
 * `path` under `.git/splates` when it names a file under `.git/arbor`, as
 * plans, todos and conversations written before the move do.
 */
export function movedPath(path: string): string {
	return path.replace(`/.git/${LEGACY_DIR}/`, "/.git/splates/");
}

/** The old name of the file a repo keeps `file`'s settings in, or null. */
export function legacyFile(file: string): string | null {
	const old: Record<string, string> = {
		"splates.config.ts": LEGACY_CONFIG_FILE,
		"splates.systems.ts": LEGACY_SYSTEMS_FILE,
	};
	return old[file] ?? null;
}

/** What `renameLegacyFiles` and `removeLegacySkill` work with. */
export interface LegacyRepoOptions {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	ps: Ps;
	log: Logger;
}

/**
 * Renames `arbor.config.ts` and `arbor.systems.ts` to splates's names, through
 * git when it tracks them so the rename is staged as one, and points their
 * imports of `@webappwiz/arbor` at `@stringsync/splates-server`. Leaves a file
 * alone when one under the new name is already there.
 */
export async function renameLegacyFiles({
	root,
	fs,
	ps,
	log,
}: LegacyRepoOptions): Promise<void> {
	for (const next of ["splates.config.ts", "splates.systems.ts"]) {
		const old = legacyFile(next);
		if (
			old === null ||
			!(await fs.exists(`${root}/${old}`)) ||
			(await fs.exists(`${root}/${next}`))
		) {
			continue;
		}
		const { exitCode } = await ps.spawnCapture(["git", "mv", old, next], {
			cwd: root,
		});
		if (exitCode !== 0) {
			await fs.rename(`${root}/${old}`, `${root}/${next}`);
		}
		const path = `${root}/${next}`;
		await fs.write(
			path,
			(await fs.read(path)).replaceAll(
				"@webappwiz/arbor",
				"@stringsync/splates-server",
			),
		);
		log.info(`renamed ${old} to ${next}`);
	}
	const manifest = await fs.read(`${root}/package.json`).catch(() => "");
	if (manifest.includes('"@webappwiz/arbor"')) {
		log.info(
			"package.json names @webappwiz/arbor: install @stringsync/splates in its place",
		);
	}
}

/**
 * Takes arbor's skill at `path` out of its project, which splates's replaces.
 * Leaves one that links to a copy kept by hand.
 */
export async function removeLegacySkill(
	path: string,
	{ fs, log }: { fs: Fs; log: Logger },
): Promise<void> {
	if (!(await fs.exists(path)) || (await fs.isSymlink(path))) {
		return;
	}
	await fs.rm(path, { recursive: true });
	log.info(`removed arbor's skill at ${path}: the splates skill replaces it`);
}

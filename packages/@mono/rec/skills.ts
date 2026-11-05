import { createHash } from "node:crypto";
import type { Fs } from "core/system";

// Where the rec skill ships inside this package, for `rec skills add` to copy.
// A test keeps it equal to `rec/skills/rec`.
export const BUNDLED_SKILL = `${import.meta.dir}/skill/SKILL.md`;

const VERSION_LINE = /^version: ([0-9a-f]+)\n/m;

/** The skill text `rec skills add` writes: without the `paths` scope to rec's folder, and with a `version` hash of itself. */
export function stamp(source: string): string {
	const body = source.replace(/^paths: .*\n/m, "");
	const version = hash(body);
	return body.replace(/\n---\n/, `\nversion: ${version}\n---\n`);
}

/** Whether installed text still matches the stamp it was written with. */
export function isUntouched(installed: string): boolean {
	const match = VERSION_LINE.exec(installed);
	return (
		match !== null && hash(installed.replace(VERSION_LINE, "")) === match[1]
	);
}

function hash(text: string): string {
	return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** The two folders an agent harness reads skills from, under `root`. */
export function skillDirs(root: string): string[] {
	return [`${root}/.claude/skills/rec`, `${root}/.agents/skills/rec`];
}

/** `force` overwrites files that were edited by hand. */
export interface InstallOptions {
	force: boolean;
}

export type InstallResult =
	| { ok: true; written: string[] }
	| { ok: false; reason: string };

/**
 * Copies the bundled skill into each folder under `root`. Nothing is written
 * unless every target can be: a symlink (which would write through to
 * another skill's source) or hand-edited files stop it, unless `force`.
 */
export async function installSkill(
	fs: Fs,
	source: string,
	root: string,
	opts: InstallOptions,
): Promise<InstallResult> {
	const { force } = opts;
	const text = stamp(source);
	const targets = skillDirs(root).map((dir) => `${dir}/SKILL.md`);
	for (const target of targets) {
		const dir = target.slice(0, -"/SKILL.md".length);
		if (await fs.isSymlink(dir)) {
			return {
				ok: false,
				reason: `${dir} is a symlink, so writing would change the skill it points at; remove it first`,
			};
		}
		if (!force && (await fs.exists(target))) {
			if (!isUntouched(await fs.read(target))) {
				return {
					ok: false,
					reason: `${target} was edited by hand or not installed by rec; rerun with --force to overwrite it`,
				};
			}
		}
	}
	for (const target of targets) {
		await fs.mkdir(target.slice(0, -"/SKILL.md".length), { recursive: true });
		await fs.write(target, text);
	}
	return { ok: true, written: targets };
}

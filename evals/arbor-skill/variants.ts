import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { $ } from "bun";
import { skillHash } from "./sections";

/**
 * A version of the skill to run, read from a directory holding SKILL.md or
 * from a git ref's `skills/arbor`, such as `main`.
 */
export async function variant(
	given: string,
	opts: VariantOptions,
): Promise<Variant> {
	const isDir = await stat(given).then(
		(each) => each.isDirectory(),
		() => false,
	);
	let dir = given;
	if (!isDir) {
		dir = await mkdtemp(join(tmpdir(), "arbor-skill-"));
		const archive = await $`git archive ${given} skills/arbor`
			.cwd(opts.repo)
			.quiet()
			.nothrow();
		if (archive.exitCode !== 0) {
			throw new Error(
				`${given} is neither a directory nor a git ref with skills/arbor`,
			);
		}
		await $`tar -x -C ${dir} < ${archive.stdout}`.quiet();
		dir = join(dir, "skills", "arbor");
	}
	const files = new Map<string, string>();
	for (const entry of await readdir(dir, { recursive: true })) {
		const path = join(dir, entry);
		if (entry.endsWith(".md") && (await stat(path)).isFile()) {
			files.set(relative(dir, path), await readFile(path, "utf8"));
		}
	}
	if (!files.has("SKILL.md")) {
		throw new Error(`${given} holds no SKILL.md`);
	}
	return { label: given, dir, files, hash: skillHash(files) };
}

export interface VariantOptions {
	/** The repository a git ref is read from. */
	repo: string;
}

export interface Variant {
	/** As it was given on the command line. */
	label: string;
	/** A directory holding it, copied into each fixture. */
	dir: string;
	/** Its markdown files by path within it. */
	files: Map<string, string>;
	/** Names this version of it in the results. */
	hash: string;
}

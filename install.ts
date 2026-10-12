import { dirname } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { skill } from "./skill";

/**
 * Where agents look for the skill, under the repository root: Claude Code reads
 * `.claude/skills`, and Codex and the others `.agents/skills`. Both get a copy
 * rather than a link, so it works wherever the repository is checked out; when
 * one directory links to the other, the second write finds the first.
 */
export const SKILL_PATHS = [
	".agents/skills/arbor/SKILL.md",
	".claude/skills/arbor/SKILL.md",
];

/** The `version:` in the skill's frontmatter, or null when it has none. */
export function versionOf(md: string): string | null {
	// frontmatter only, so a `version:` inside a fenced example in the body is
	// not mistaken for the real one
	const frontmatter = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
	return frontmatter.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? null;
}

/**
 * Sets a repository up for agents to work in through arbor: writes this
 * release's skill where each agent looks, over whatever copy was there. The
 * skill's description is what has an agent reach for it, so the repository's
 * own agent instructions are left as they are. Run again, it changes only what
 * a newer release changed. Leaves committing what it wrote to the person, so
 * each agent's worktree, which starts from trunk, has the skill too.
 */
export async function install({
	root,
	fs,
	log,
}: {
	root: string;
	fs: Fs;
	log: Logger;
}): Promise<void> {
	const version = versionOf(skill);
	for (const relative of SKILL_PATHS) {
		const path = `${root}/${relative}`;
		const before = await fs.read(path).catch((): null => null); // not there yet
		if (before === skill) {
			log.info(`${relative} is already arbor ${version}`);
			continue;
		}
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.write(path, skill);
		const was = before === null ? null : versionOf(before);
		log.info(
			`${color.green("wrote")} ${relative}: arbor ${was === null ? "" : `${was} to `}${version}`,
		);
	}
}

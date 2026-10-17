import type { Logger } from "webappwiz/log";
import { ProjectSkills, SKILLS_DIR, versionOf } from "webappwiz/skills";
import type { Fs, Ps } from "webappwiz/system";

/**
 * The repository arbor's skill comes from: each release is a tag in it, and
 * the skill its `skills/arbor/SKILL.md`, which `bunx skills add` finds.
 */
export const SOURCE = "jaredjj3/webappwiz";

/** The skills a project at `root` has, installing arbor's from `SOURCE`. */
export function projectSkills(
	root: string,
	deps: { fs: Fs; ps: Ps; log: Logger },
): ProjectSkills {
	return new ProjectSkills(root, { ...deps, source: SOURCE });
}

/** The installed arbor skill's version, or null when absent or unreadable. */
export function installedVersion(fs: Fs, root: string): Promise<string | null> {
	return fs
		.read(`${root}/${SKILLS_DIR}/arbor/SKILL.md`)
		.then(versionOf)
		.catch((): null => null);
}

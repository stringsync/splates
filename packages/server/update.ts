import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { lanesFromTags } from "./board";
import { LEGACY, removeLegacySkill, renameLegacyFiles } from "./legacy-names";
import { moveSystems, typeConfig } from "./migrate-config";
import { isNewer, RUNNING } from "./release";
import { projectSkills } from "./skills";

/**
 * Set in the environment of the splates `update` hands itself to, so that one
 * refreshes rather than looking for a newer one again: npm can name a version
 * a moment before `bunx` can fetch it.
 */
export const UPDATING = "SPLATES_UPDATING";

/**
 * Brings this repository up to the newest splates: when npm has a newer release
 * than the one running, runs `update` again on that one, which does the rest
 * itself; otherwise moves todos saved with tags into lanes, installs this
 * one's skill over whatever copy is there, through `bunx skills add` from
 * this release's tag, and moves what an older config holds to where this
 * one reads it. Offline, the running release is the newest there is to
 * have. `wiz update` names the release instead, as it pins every webappwiz
 * package to one. Answers with the exit code to end on.
 */
export async function update({
	root,
	fs,
	ps,
	log,
	newest,
	release,
}: {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The latest splates on npm, or null when it cannot say; unasked given `release`. */
	newest?: () => Promise<string | null>;
	/** The release whose skill to install, rather than the newest. */
	release?: string;
}): Promise<number> {
	if (release === undefined && newest && ps.env(UPDATING) === undefined) {
		const latest = await newest();
		if (latest === null) {
			log.info(`could not reach npm: refreshing from splates ${RUNNING}`);
		} else if (isNewer(latest, RUNNING)) {
			log.info(`${color.green("updating")} splates ${RUNNING} to ${latest}`);
			const { exitCode } = await ps.spawn(
				["bunx", `@stringsync/splates@${latest}`, "update"],
				{ env: { [UPDATING]: "1" } },
			);
			return exitCode;
		}
	}
	await lanesFromTags({ dir: root, fs, ps, log });
	// Before the skill, whose download can fail, so the config is read by its
	// new name either way.
	await renameLegacyFiles({ root, fs, ps, log });
	const skills = projectSkills(root, { fs, ps, log });
	await skills.add(["splates"], release ?? RUNNING);
	// Only once splates's is in, so a project is never left with neither.
	await removeLegacySkill(`${root}/${skills.path(LEGACY)}`, { fs, log });
	const code = await moveSystems({ root, fs, log });
	await typeConfig({ root, fs, log });
	return code;
}

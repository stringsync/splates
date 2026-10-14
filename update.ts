import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { moveSystems } from "./move-systems";
import { isNewer, RUNNING } from "./release";
import { ProjectSkills } from "./skills";

/**
 * Set in the environment of the arbor `update` hands itself to, so that one
 * refreshes rather than looking for a newer one again: npm can name a version
 * a moment before `bunx` can fetch it.
 */
export const UPDATING = "ARBOR_UPDATING";

/**
 * Brings this repository up to the newest arbor: when npm has a newer release
 * than the one running, runs `update` again on that one, which installs its own
 * skill; otherwise installs this one's over whatever copy is there, through
 * `bunx skills add` from this release's tag, and moves what an older config
 * holds to where this one reads it. Offline, the running release is
 * the newest there is to have. Answers with the exit code to end on.
 */
export async function update({
	root,
	fs,
	ps,
	log,
	newest,
}: {
	/** The repository's main tree. */
	root: string;
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The latest arbor on npm, or null when it cannot say. */
	newest: () => Promise<string | null>;
}): Promise<number> {
	if (ps.env(UPDATING) === undefined) {
		const latest = await newest();
		if (latest === null) {
			log.info(`could not reach npm: refreshing from arbor ${RUNNING}`);
		} else if (isNewer(latest, RUNNING)) {
			log.info(`${color.green("updating")} arbor ${RUNNING} to ${latest}`);
			const { exitCode } = await ps.spawn(
				["bunx", `@webappwiz/arbor@${latest}`, "update"],
				{ env: { [UPDATING]: "1" } },
			);
			return exitCode;
		}
	}
	await new ProjectSkills(root, { fs, ps, log }).add(["arbor"], RUNNING);
	return await moveSystems({ root, fs, log });
}

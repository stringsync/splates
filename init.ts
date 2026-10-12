import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import type { Git } from "./git";
import { install } from "./install";
import type { Projects } from "./projects";

/**
 * Makes this repository an arbor project: `repository` has set up its records
 * by now, when it had none, so what is left is installing the skill that
 * teaches its agents to work through arbor, and joining the registry, which
 * lets one `arbor dev` serve it beside every other. Run again, or in a
 * project already under way, it changes nothing that is already so.
 */
export async function init({
	git,
	projects,
	fs,
	log,
}: {
	git: Git;
	projects: Projects;
	fs: Fs;
	log: Logger;
}): Promise<void> {
	await install({ root: git.root, fs, log });
	if (await projects.register(git.root)) {
		log.info(`${color.green("registered")} ${git.root} in ${projects.path}`);
	} else {
		log.info(`${git.root} is already registered in ${projects.path}`);
	}
	log.info(
		"commit what it wrote, so every task's worktree has the skill, and `arbor update` now and then to keep it current",
	);
}

/**
 * Takes this repository off the registry, so `arbor dev` no longer offers it:
 * its records stay, and `arbor init` brings it back.
 */
export async function forget({
	git,
	projects,
	log,
}: {
	git: Git;
	projects: Projects;
	log: Logger;
}): Promise<void> {
	if (await projects.forget(git.root)) {
		log.info(`${color.green("forgot")} ${git.root} in ${projects.path}`);
		return;
	}
	log.info(`${git.root} is not registered in ${projects.path}`);
}

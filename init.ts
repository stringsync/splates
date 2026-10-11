import { color, type Logger } from "webappwiz/log";
import type { Git } from "./git";
import type { Projects } from "./projects";

/**
 * Makes this repository an arbor project: `repository` has set up its records
 * by now, when it had none, so what is left is joining the registry, which
 * lets one `arbor dev` serve it beside every other. Run again, or in a
 * project already under way, it only registers.
 */
export async function init({
	git,
	projects,
	log,
}: {
	git: Git;
	projects: Projects;
	log: Logger;
}): Promise<void> {
	if (await projects.register(git.root)) {
		log.info(`${color.green("registered")} ${git.root} in ${projects.path}`);
		return;
	}
	log.info(`${git.root} is already registered in ${projects.path}`);
}

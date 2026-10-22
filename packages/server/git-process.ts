import type { Ps } from "webappwiz/system";
import type { GitRunner } from "./git";

/** `GitRunner` as a process through `ps`. */
export function processGit(ps: Ps): GitRunner {
	return {
		git: async (cwd, args, env) => {
			const { exitCode, stdout, stderr } = await ps.spawnCapture(
				["git", "-C", cwd, ...args],
				env === undefined ? undefined : { env },
			);
			return { code: exitCode, stdout, stderr };
		},
	};
}

/** Whether git reaches `url` over SSH, as a deploy key signs in. */
export function sshUrl(url: string | null): boolean {
	return (
		url !== null && (/^ssh:\/\//.test(url) || /^[\w.-]+@[\w.-]+:/.test(url))
	);
}

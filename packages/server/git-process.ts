import type { Ps } from "webappwiz/system";
import type { GitRunner } from "./git";

let resolvedGit: string | undefined;

/** The git command to run, resolved once and cached. */
export function gitBinary(): string {
	// On macOS `/usr/bin/git` is a stub that asks `xcrun` for Xcode's git on
	// every call (~15ms), so when it is the git on PATH, run the real one;
	// any other git on PATH (Homebrew's) is left to PATH.
	if (resolvedGit !== undefined) {
		return resolvedGit;
	}
	resolvedGit = "git";
	if (process.platform === "darwin" && Bun.which("git") === "/usr/bin/git") {
		try {
			const found = Bun.spawnSync(["xcrun", "--find", "git"], {
				stdout: "pipe",
				stderr: "ignore",
			});
			const path = found.stdout.toString().trim();
			if (found.exitCode === 0 && path !== "" && path !== "/usr/bin/git") {
				resolvedGit = path;
			}
		} catch {
			// no xcrun: keep the stub
		}
	}
	return resolvedGit;
}

/** `GitRunner` as a process through `ps`. */
export function processGit(ps: Pick<Ps, "start">): GitRunner {
	return {
		git: async (cwd, args, env) => {
			const child = ps.start(
				[gitBinary(), "-C", cwd, ...args],
				env === undefined ? undefined : { env },
			);
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				// Nothing is written to git, so closing stdin only says so. A git
				// that exits before the close lands rejects it with a premature
				// close, which is no failure of the command.
				child.stdin.close().catch(() => undefined),
			]);
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

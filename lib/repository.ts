import { dirname } from "node:path";
import type { Middleware } from "@webappwiz/cmd";
import type { Logger } from "@webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "@webappwiz/sys";
import { type Config, loadConfig } from "./config";
import { CliGit, type Git } from "./git";
import { FileJournal, type Journal } from "./journal";
import { PosixShell, type Shell } from "./shell";
import { GitWorktreeStore, type WorktreeStore } from "./worktree-store";

/** What a command gets to work with, once there is a repository to work in. */
export interface Repository {
	config: Config;
	git: Git;
	store: WorktreeStore;
	lock: Lock;
	shell: Shell;
	journal: Journal;
}

/**
 * Runs the action against the repository `cwd` sits in, and refuses to run it
 * at all when that is not a repository.
 */
export function repository<C extends object>(
	fs: Fs,
	ps: Ps,
	log: Logger,
	cwd: string = ps.cwd(),
): Middleware<C, C & Repository> {
	// Nothing below here touches `Fs` or `Ps`: this is the only place they are
	// spoken.
	return async (ctx, next) => {
		const { exitCode, stdout } = await ps.spawnCapture([
			"git",
			"-C",
			cwd,
			"rev-parse",
			"--path-format=absolute",
			"--git-common-dir",
		]);
		if (exitCode !== 0) {
			throw new Error(`not a git repository: ${cwd}`);
		}
		// Every worktree shares one `.git`, so state kept under it is visible to
		// every agent and is inherently untracked.
		const gitDir = stdout.trim();
		const arborDir = `${gitDir}/arbor`;

		const config = await loadConfig(fs, dirname(gitDir));
		const git = new CliGit(ps, fs, dirname(gitDir));
		const store = new GitWorktreeStore(fs, ps, git, config, arborDir);
		await store.init();

		await next({
			...ctx,
			config,
			git,
			store,
			lock: new FileLock(fs, ps, log, `${arborDir}/graft.lock`, {
				stalenessMs: config.leaseStalenessMs,
			}),
			shell: new PosixShell(ps),
			journal: new FileJournal(fs, `${arborDir}/log.jsonl`, config.logCapacity),
		});
	};
}

import { dirname } from "node:path";
import type { Deps, Middleware } from "@webappwiz/cmd";
import { FileLock, type Fs } from "@webappwiz/sys";
import { type Config, loadConfig } from "./config";
import { Git } from "./git";
import { Journal } from "./journal";
import { Shell } from "./shell";
import { WorktreeStore } from "./worktree-store";

/** What a command gets to work with, once there is a repository to work in. */
export interface Repository {
	config: Config;
	git: Git;
	store: WorktreeStore;
	lock: FileLock;
	shell: Shell;
	journal: Journal;
}

/**
 * Runs the action against the repository `cwd` sits in, and refuses to run it
 * at all when that is not a repository.
 */
export function repository<C extends Deps & { fs: Fs }>(
	at?: string,
): Middleware<C, C & Repository> {
	// Nothing below here touches `Fs` or `Ps`: this is the only place they are
	// spoken.
	return async (ctx, next) => {
		const { fs, ps, log } = ctx;
		const cwd = at ?? ps.cwd();
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
		const git = new Git(ps, fs, dirname(gitDir));
		const store = new WorktreeStore(fs, ps, git, config, arborDir);
		await store.init();

		await next({
			...ctx,
			config,
			git,
			store,
			lock: new FileLock(fs, ps, log, `${arborDir}/merge.lock`, {
				stalenessMs: config.leaseStalenessMs,
			}),
			shell: new Shell(ps),
			journal: new Journal(fs, `${arborDir}/log.jsonl`, config.logCapacity),
		});
	};
}

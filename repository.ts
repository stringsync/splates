import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import { FileLock, type Fs, type Lock } from "webappwiz/system";
import type { Config } from "./config";
import { Git } from "./git";
import { Journal } from "./journal";
import { loadConfig } from "./load-config";
import { Shell } from "./shell";
import { WorktreeService } from "./worktree-service";

/** What a command gets to work with, once there is a repository to work in. */
export interface Repository {
	config: Config;
	git: Git;
	service: WorktreeService;
	lock: Lock;
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

		const git = new Git(dirname(gitDir), { ps, fs });
		const config = await loadConfig(dirname(gitDir), { fs, git });
		const service = new WorktreeService(git, config, arborDir, { fs, ps });
		await service.init();

		await next({
			...ctx,
			config,
			git,
			service,
			lock: new FileLock(`${arborDir}/merge.lock`, {
				fs,
				ps,
				log,
				stalenessMs: config.get("leaseStalenessMs"),
			}),
			shell: new Shell({ ps }),
			journal: new Journal(`${arborDir}/log.jsonl`, config.get("logCapacity"), {
				fs,
			}),
		});
	};
}

import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import { FileLock, type Fs, type Lock } from "webappwiz/system";
import type { Config } from "./config";
import { Format } from "./format";
import { Git } from "./git";
import { Journal } from "./journal";
import { loadConfig } from "./load-config";
import { Projects } from "./projects";
import { Shell } from "./shell";
import { Todos } from "./todos";
import { WorktreeService } from "./worktree-service";

/** What a command gets to work with, once there is a repository to work in. */
export interface Repository {
	/** Where arbor keeps its records: `.git/arbor`, shared by every worktree. */
	arborDir: string;
	config: Config;
	/** Checked before the command runs, so its records are in this arbor's format. */
	format: Format;
	git: Git;
	service: WorktreeService;
	lock: Lock;
	shell: Shell;
	journal: Journal;
	todos: Todos;
	/** Every arbor project on this machine, which every command joins. */
	projects: Projects;
}

/** How `repository` treats records in an older format than this arbor's. */
export interface RepositoryOptions {
	/**
	 * Brings them forward before the action runs. Only `arbor dev` does: a
	 * migration is the server's to run, with its sessions settled, so every
	 * other command refuses them until it has.
	 */
	migrates?: boolean;
	/** Where to look for the repository; the working directory by default. */
	at?: string;
}

/**
 * Runs the action against the repository `cwd` sits in, and refuses to run it
 * at all when that is not a repository, or its records are in a format this
 * arbor does not read.
 */
export function repository<C extends Deps & { fs: Fs }>({
	migrates = false,
	at,
}: RepositoryOptions = {}): Middleware<C, C & Repository> {
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
		// Before anything reads a record.
		const format = new Format(arborDir, {
			fs,
			lock: new FileLock(`${arborDir}/format.lock`, {
				fs,
				ps,
				log,
				stalenessMs: config.leaseStalenessMs,
			}),
			log,
		});
		await (migrates ? format.migrate() : format.check());

		// The user's, shared by every repository on this machine: any command
		// run in one makes it an arbor project, so it joins here. `ARBOR_HOME`
		// moves it, as the tests do to keep theirs out of the user's.
		const registry =
			ps.env("ARBOR_HOME") ?? `${ps.env("HOME") ?? homedir()}/.arbor`;
		const projects = new Projects(`${registry}/projects.json`, {
			fs,
			lock: new FileLock(`${registry}/projects.lock`, {
				fs,
				ps,
				log,
				stalenessMs: config.leaseStalenessMs,
			}),
		});
		await projects.register(git.root);

		await next({
			...ctx,
			projects,
			arborDir,
			config,
			format,
			git,
			service,
			lock: new FileLock(`${arborDir}/merge.lock`, {
				fs,
				ps,
				log,
				stalenessMs: config.leaseStalenessMs,
			}),
			shell: new Shell({ ps }),
			journal: new Journal(`${arborDir}/log.jsonl`, config.logCapacity, {
				fs,
			}),
			todos: new Todos(
				`${arborDir}/todos`,
				new FileLock(`${arborDir}/todos.lock`, {
					fs,
					ps,
					log,
					stalenessMs: config.leaseStalenessMs,
				}),
				{ fs },
			),
		});
	};
}

import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import { FileLock, type Fs, type Lock } from "webappwiz/system";
import type { Config } from "./config";
import { Creds, type SecretStores, SYSTEM_STORES } from "./creds";
import { Format } from "./format";
import { Git } from "./git";
import { Journal } from "./journal";
import { loadConfig } from "./load-config";
import { Outcomes } from "./outcomes";
import { Projects } from "./projects";
import { arborHome } from "./roster";
import { Shell } from "./shell";
import { Slots } from "./slots";
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
	/** Every arbor project on this machine, which `arbor init` joins this one to. */
	projects: Projects;
	/** The creds agents ask for, and the stores they are kept in. */
	creds: Creds;
	/** The machine's dev slots, which a task gives back as it ends. */
	slots: Slots;
}

/** How `repository` treats records in an older format than this arbor's. */
export interface RepositoryOptions {
	/**
	 * Brings them forward before the action runs. Only `arbor dev` does: a
	 * migration is the server's to run, with its sessions settled, so every
	 * other command refuses them until it has.
	 */
	migrates?: boolean;
	/**
	 * Sets up the records of a repository that has none first, as only
	 * `arbor init` does: every other command refuses one.
	 */
	creates?: boolean;
	/** Where to look for the repository; the working directory by default. */
	at?: string;
}

/**
 * Runs the action against the repository `cwd` sits in, and refuses to run it
 * at all when that is not a repository, or its records are in a format this
 * arbor does not read.
 */
export function repository<C extends Deps & { fs: Fs; secrets?: SecretStores }>(
	opts: RepositoryOptions = {},
): Middleware<C, C & Repository> {
	return async (ctx, next) =>
		next({ ...ctx, ...(await openRepository(ctx, opts)) });
}

/**
 * What a command works with in the repository `at` sits in, the working
 * directory by default: what `repository` hands an action, and what `arbor
 * dev` opens each project it serves with. Refuses what `repository` does.
 */
export async function openRepository(
	{
		fs,
		ps,
		log,
		secrets = SYSTEM_STORES,
	}: Deps & { fs: Fs; secrets?: SecretStores },
	{ migrates = false, creates = false, at }: RepositoryOptions = {},
): Promise<Repository> {
	// Nothing below here touches `Fs` or `Ps`: this is the only place they are
	// spoken.
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
	// Before anything reads or makes a record.
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
	if (creates) {
		await format.create();
	}
	await (migrates ? format.migrate() : format.check());
	// The user's, shared by every repository on this machine: the registry,
	// which only `arbor init` writes this one into, and how each task ended.
	// `ARBOR_HOME` moves it, as the tests do to keep theirs out of the user's.
	const registry = arborHome(ps);
	const service = new WorktreeService(git, config, arborDir, {
		fs,
		ps,
		outcomes: new Outcomes(`${registry}/outcomes.jsonl`, fs),
	});
	await service.init();

	const projects = Projects.ofMachine({ fs, ps, log }, config.leaseStalenessMs);

	return {
		projects,
		slots: Slots.ofMachine({ fs, ps, log }),
		creds: await Creds.open(
			arborDir,
			git.root,
			new FileLock(`${arborDir}/creds.lock`, {
				fs,
				ps,
				log,
				stalenessMs: config.leaseStalenessMs,
			}),
			secrets,
			{ fs },
		),
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
			ps,
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
	};
}

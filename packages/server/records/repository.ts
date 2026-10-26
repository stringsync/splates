import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { TaskStore, Tasks } from "../board";
import type { Config } from "../config";
import {
	LEGACY_DIR,
	loadConfig,
	moveLegacyDir,
	movePlan,
	unmigrated,
} from "../config";
import { Creds, type SecretStores, SYSTEM_STORES } from "../creds";
import { fail } from "../exit";
import { Git } from "../git";
import { CoordinatorLanding, TaskBranches, type TrunkLanding } from "../merge";
import { PLAN_FILE, PlanStore, Plans } from "../plans";
import { Slots } from "../ports";
import { Projects, type Reach, reaches } from "../projects";
import { RUNNING } from "../server/release";
import { type PlacedLock, premergeLockOfProject } from "../server/shared";
import { Adherence, Outcomes } from "../stats";
import { FsStorage, type Storage } from "../storage";
import { WorktreeService } from "../tasks";
import { Shell } from "../terminal";
import { Format } from "./format";
import { ProjectHome } from "./home";
import { Journal } from "./journal";
import { LeaseLock } from "./lease-lock";
import { MIGRATING, Migration } from "./migration";

/**
 * Runs the action against the repository `cwd` sits in, or the registered
 * project `--project` names, and refuses to run it at all when that is not
 * a repository, its records are in a format this splates does not read, or
 * the command is run from another project that has not been granted what
 * it `needs` there.
 */
export function repository<
	C extends Deps & { fs: Fs; secrets?: SecretStores; project?: string },
>(
	opts: Omit<RepositoryOptions, "at"> & { needs: Needs },
): Middleware<C, C & Repository & Reached> {
	return async (ctx, next) => {
		const at =
			ctx.project === undefined
				? undefined
				: (await Projects.ofMachine(ctx).named(ctx.project)).root;
		const repo = await openRepository(ctx, { ...opts, at });
		try {
			const elsewhere = await checkReach({ ...ctx, ...repo }, repo, opts.needs);
			await next({ ...ctx, ...repo, elsewhere });
		} finally {
			repo.dispose();
		}
	};
}

/** What a command works with once there is a repository to work in. */
export interface Repository {
	/**
	 * The project's directory under the splates home, `projects/<id>`, shared
	 * by every worktree: its database and the files beside it.
	 */
	dir: string;
	/** Closes what the command held open: the project's database. */
	dispose(): void;
	/** The project's records, in its database. */
	storage: Storage;
	/** What every project on this machine shares, under the splates home. */
	machine: Storage;
	/** Reads and writes the command's files. */
	fs: Fs;
	config: Config;
	/** Checked before the command runs, so its records are in this splates's format. */
	format: Format;
	git: Git;
	service: WorktreeService;
	/** The merge lease, which one merge in the repository holds at a time. */
	lock: Lock;
	shell: Shell;
	journal: Journal;
	tasks: Tasks;
	/** How each task on this machine ended, which a merge reads its findings from. */
	outcomes: Outcomes;
	/** Every splates project on this machine, which `splates init` joins this one to. */
	projects: Projects;
	/** The creds agents ask for, and the stores they are kept in. */
	creds: Creds;
	/** The machine's dev slots, which a task gives back as it ends. */
	slots: Slots;
	/** Held by a merge's gate, so one premerge runs per project at a time. */
	premerge: PlacedLock;
	/** Each task's branch on the central remote, which a task pushes as it goes. */
	branches: TaskBranches;
	/** What moves trunk on the central remote once a merge has tested its branch. */
	trunk: TrunkLanding;
}

/** How `repository` treats records in an older format than this splates's. */
export interface RepositoryOptions {
	/**
	 * Brings them forward before the action runs. Set by `splates server` alone;
	 * every other command refuses old records until the server has migrated them.
	 */
	migrates?: boolean;
	/**
	 * Sets up the records of a repository that has none first, as only
	 * `splates init` does: every other command refuses one.
	 */
	creates?: boolean;
	/** Where to look for the repository; the working directory by default. */
	at?: string;
}

/**
 * What a command needs of the project it runs on, when an agent of another
 * project runs it: a reach that project must have granted, or `own` for a
 * command no other project may run there at all.
 */
export type Needs = Reach | "own";

/** What `repository` adds beyond the repository itself. */
export interface Reached {
	/**
	 * The main tree of the other project the command is run from, as checked
	 * against what it `needs`; null when run from this one, or from none.
	 */
	elsewhere: string | null;
}

/**
 * The other project a command is run from, refusing one that has not been
 * granted what it `needs` here. The project acting is the one whose `splates server` conversation runs the
 * command, so an agent that `cd`s here is checked as one that names this
 * project with `--project`; else, for an agent outside the page, the one
 * `cwd` sits in.
 */
async function checkReach(
	{ fs, ps, log, project }: Deps & { fs: Fs; project?: string },
	{ git, projects, service }: Repository,
	needs: Needs,
): Promise<string | null> {
	const from =
		(await service.conversation()) !== undefined
			? git.root
			: ((await conversationHome(
					{ fs, ps, log },
					ps.env("SPLATES_CONVERSATION"),
					projects,
				)) ?? (project === undefined ? git.root : await mainTree(ps)));
	if (from === null || from === git.root) {
		return null;
	}
	const slugs = await projects.list();
	const called = (root: string) =>
		slugs.find((each) => each.root === root)?.slug ?? root;
	if (needs === "own") {
		fail(
			"not_granted",
			`this command runs only on ${called(git.root)} itself, never from ${called(from)}: an agent there hands work here to an agent of its own instead`,
			{ from: called(from), to: called(git.root) },
		);
	}
	const reach = await projects.reach(from, git.root);
	if (!reaches(reach, needs)) {
		fail(
			"not_granted",
			[
				`${called(git.root)} lets ${called(from)} ${reach === "read" ? "only read" : "only queue tasks"} here, and this needs ${needs}.`,
				`Ask the user whether it may: once they say so, \`splates projects grant ${called(from)} ${needs}\` run in ${git.root} grants it.`,
			].join("\n"),
			{ from: called(from), to: called(git.root), reach, needs },
		);
	}
	return from;
}

/**
 * The main tree of the registered project whose `splates server` conversation
 * `id` is, or null for one of none.
 */
async function conversationHome(
	{ fs, ps, log }: Deps & { fs: Fs },
	id: string | undefined,
	projects: Projects,
): Promise<string | null> {
	if (id === undefined) {
		return null;
	}
	for (const each of await projects.list()) {
		const home = new ProjectHome(each.root, { fs, ps, log, projects });
		try {
			const records = (await home.exists())
				? await home.open()
				: new FsStorage(
						unmigrated(
							`${each.root}/.git/splates`,
							`${each.root}/.git/${LEGACY_DIR}`,
						),
						fs,
					);
			if (await records.log(`conversations/${id}.jsonl`).exists()) {
				return each.root;
			}
		} finally {
			home.dispose();
		}
	}
	return null;
}

/** The main tree of the repository `cwd` sits in, or null outside one. */
async function mainTree(ps: Ps): Promise<string | null> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		ps.cwd(),
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	return exitCode === 0 ? dirname(stdout.trim()) : null;
}

/**
 * How `format`'s records move forward under the guard `Migration` keeps:
 * backed up, run in a child `splates migrate` of this splates, and put back
 * when it fails.
 */
export function migrationOf(
	format: Format,
	{ fs, ps, log }: Deps & { fs: Fs },
	/** Where the records end up, whose old files are left aside once moved. */
	home?: ProjectHome,
): Migration {
	return new Migration(format, {
		fs,
		log,
		lock: new FileLock(`${format.splatesDir}-migration.lock`, {
			fs,
			ps,
			log,
			pidOnly: true,
		}),
		release: RUNNING,
		child: Migration.childOf(ps, dirname(dirname(format.splatesDir))),
		settle: home && (() => home.leaveAside(format.splatesDir)),
	});
}

/**
 * What `splates migrate` does in the repository `at` sits in: as the child a
 * `Migration` runs, the steps themselves; otherwise the guarded migration,
 * trying again past a failure kept for this release.
 */
export async function migrateRecords(
	deps: Deps & { fs: Fs },
	{ at }: { at?: string } = {},
): Promise<number> {
	const { ps } = deps;
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
	const migration = await recordsMigration(deps, stdout.trim());
	if (ps.env(MIGRATING) !== undefined) {
		await migration.format.migrate();
	} else {
		await migration.run({ retry: true });
	}
	return migration.format.current;
}

/**
 * The guarded migration of the records under `gitDir`, once an old name for
 * their directory has moved to splates's.
 */
export async function recordsMigration(
	deps: Deps & { fs: Fs },
	gitDir: string,
): Promise<Migration> {
	const { fs, ps, log } = deps;
	await moveLegacyDir(`${gitDir}/${LEGACY_DIR}`, `${gitDir}/splates`, {
		fs,
		log,
	});
	const splatesDir = `${gitDir}/splates`;
	const home = new ProjectHome(dirname(gitDir), {
		fs,
		ps,
		log,
		projects: Projects.ofMachine({ fs, ps, log }),
	});
	const format = new Format(splatesDir, {
		fs,
		lock: new FileLock(`${splatesDir}-format.lock`, {
			fs,
			ps,
			log,
			pidOnly: true,
		}),
		log,
		database: home.stamp(),
		into: home,
	});
	return migrationOf(format, deps, home);
}

/**
 * What a command works with in the repository `at` sits in, the working
 * directory by default: what `repository` hands an action, and what `splates
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
	if (migrates) {
		await moveLegacyDir(`${gitDir}/${LEGACY_DIR}`, `${gitDir}/splates`, {
			fs,
			log,
		});
	}
	// Where the records were kept before the database: still where a checkout
	// that has not moved them is.
	const splatesDir = unmigrated(`${gitDir}/splates`, `${gitDir}/${LEGACY_DIR}`);
	// The registry is the user's, shared by every repository on this machine:
	// `SPLATES_HOME` moves it, as the tests do to keep theirs out of the user's.
	const projects = Projects.ofMachine({ fs, ps, log });
	const home = new ProjectHome(dirname(gitDir), { fs, ps, log, projects });
	const root = dirname(gitDir);
	const git = new Git(root, { ps, fs });
	const config = await loadConfig(root, {
		fs,
		git,
	});
	const lockAt = (path: string): Lock =>
		new FileLock(path, {
			fs,
			ps,
			log,
			stalenessMs: config.leaseStalenessMs,
			pidOnly: true,
		});
	// The project's directory under the splates home, beside its database,
	// where the merge lease is kept.
	const dir =
		creates || migrates || (await home.exists())
			? await home.dir()
			: splatesDir;
	// The merge lease: one per repository, kept on disk so it outlives a
	// restart, and held for as long as its holder lives, so a long test run is
	// never judged stale. One whose holder dies is free once its pid is gone.
	const mergeLease = `${dir}/merge.lock`;
	const lease = new LeaseLock(mergeLease, {
		fs,
		ps,
		log,
		stalenessMs: config.leaseStalenessMs,
	});
	// Before anything reads or makes a record.
	const format = new Format(splatesDir, {
		fs,
		lock: lockAt(`${splatesDir}-format.lock`),
		log,
		database: home.stamp(),
		into: home,
	});
	const moved = creates || migrates ? null : await home.movedTo();
	if (moved !== null) {
		fail(
			"uninitialized",
			`this project's records moved to ${moved}: run splates there, or \`splates replica restore\` here to bring them back from the replica.`,
			{ movedTo: moved },
		);
	}
	if (creates) {
		await format.create();
	}
	await (migrates
		? migrationOf(format, { fs, ps, log }, home).run()
		: format.check());
	// The user's, shared by every repository on this machine: the registry,
	// which only `splates init` writes this one into, and how each task ended.
	// The one place a project's storage is picked, and the machine's.
	const storage: Storage = await home.open();
	const machine = FsStorage.ofMachine({ fs, ps, log });
	const outcomes = new Outcomes(machine);
	const store = new TaskStore(storage);
	const service = new WorktreeService(git, config, dir, {
		store,
		fs,
		storage,
		ps,
		outcomes,
		adherence: new Adherence(machine),
	});
	await service.init();
	if (migrates) {
		for (const worktree of await service.list()) {
			await movePlan(worktree.path, PLAN_FILE, fs);
		}
		await new Plans(fs).exclude(gitDir);
	}

	const creds = await Creds.open(storage, git.root, secrets);
	if (migrates) {
		await creds.copyLegacy();
	}

	return {
		fs,
		storage,
		machine,
		projects,
		branches: TaskBranches.of({
			git,
			config,
			creds,
			plans: new PlanStore(fs, storage),
		}),
		slots: Slots.ofMachine({ fs, ps, log }),
		premerge: premergeLockOfProject({ fs, ps, log, root }),
		creds,
		dir,
		dispose: () => home.dispose(),
		config,
		format,
		git,
		service,
		outcomes,
		lock: lease,
		trunk: new CoordinatorLanding({ git, fs, config, lease: mergeLease }),
		shell: new Shell({ ps }),
		journal: new Journal(storage, config.logCapacity, { ps }),
		tasks: new Tasks(store),
	};
}

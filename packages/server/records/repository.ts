import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import type { HeavyCap } from "webappwiz/system";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { SystemTimer } from "webappwiz/time";
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
import {
	CloneCheckouts,
	CoordinatorLanding,
	HOME_KEY,
	TaskBranches,
	type TrunkLanding,
} from "../merge";
import { splatesHome } from "../models";
import { PLAN_FILE, PlanStore, Plans } from "../plans";
import { Slots } from "../ports";
import { Projects, type Reach, reaches } from "../projects";
import { heavyJobsOfMachine } from "../server/shared";
import { Adherence, Outcomes } from "../stats";
import { FsStorage, type Storage } from "../storage";
import { LeaseBeat, type WorkerMachines, WorktreeService } from "../tasks";
import { Shell } from "../terminal";
import { Format } from "./format";
import { Journal } from "./journal";
import { RelayApp } from "./relay-app";
import { RelayFs } from "./relay-fs";
import { RelayLanding } from "./relay-landing";
import { RelayLock } from "./relay-lock";
import { findRelay } from "./repo-state";
import { RoutedFs } from "./routed-fs";

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
			repo.beats?.dispose();
		}
	};
}

/** What a command works with once there is a repository to work in. */
export interface Repository {
	/** Where splates keeps its records: `.git/splates`, shared by every worktree. */
	splatesDir: string;
	/**
	 * The project's records, under `splatesDir`: the coordinator's on a
	 * worker, locked through the relay.
	 */
	storage: Storage;
	/** What every project on this machine shares, under the splates home. */
	machine: Storage;
	/**
	 * Reads and writes the command's files. On a worker, the records under
	 * `splatesDir` it reaches are the coordinator's.
	 */
	fs: Fs;
	/**
	 * What keeps a worker's leases and locks fresh while the command runs,
	 * ended once it has; null on the coordinator's machine.
	 */
	beats: LeaseBeat | null;
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
	/** The machine's slots for test runs and installs, which hooks wait for. */
	heavy: HeavyCap;
	/** Each task's branch on the central remote, which a task pushes as it goes. */
	branches: TaskBranches;
	/**
	 * What moves trunk on the central remote once a merge has tested its
	 * branch: this machine itself on the coordinator, the coordinator through
	 * the relay on a worker.
	 */
	trunk: TrunkLanding;
	/** Whether this checkout's records are the coordinator's, reached through the relay. */
	relayed: boolean;
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
	/** The workers a task cloned on one is read through, as `splates server` holds them. */
	machines?: WorkerMachines;
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
	{ fs, ps, project }: Deps & { fs: Fs; project?: string },
	{ git, projects, service }: Repository,
	needs: Needs,
): Promise<string | null> {
	const from =
		(await service.conversation()) !== undefined
			? git.root
			: ((await conversationHome(
					fs,
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
	fs: Fs,
	id: string | undefined,
	projects: Projects,
): Promise<string | null> {
	if (id === undefined) {
		return null;
	}
	for (const each of await projects.list()) {
		const records = new FsStorage(
			unmigrated(
				`${each.root}/.git/splates`,
				`${each.root}/.git/${LEGACY_DIR}`,
			),
			fs,
		);
		if (await records.log(`conversations/${id}.jsonl`).exists()) {
			return each.root;
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
 * What a command works with in the repository `at` sits in, the working
 * directory by default: what `repository` hands an action, and what `splates
 * dev` opens each project it serves with. Refuses what `repository` does.
 */
export async function openRepository(
	{
		fs: disk,
		ps,
		log,
		secrets = SYSTEM_STORES,
	}: Deps & { fs: Fs; secrets?: SecretStores },
	{ migrates = false, creates = false, at, machines }: RepositoryOptions = {},
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
			fs: disk,
			log,
		});
	}
	const splatesDir = unmigrated(`${gitDir}/splates`, `${gitDir}/${LEGACY_DIR}`);
	// The registry is the user's, shared by every repository on this machine:
	// `SPLATES_HOME` moves it, as the tests do to keep theirs out of the user's.
	const _registry = splatesHome(ps);
	// A checkout with no records of its own is a worker's: they are the
	// coordinator's, reached through the relay. Never for the server or
	// `init`, which keep them here.
	const relay =
		migrates || creates || (await disk.exists(splatesDir))
			? null
			: await findRelay(
					{
						machine: FsStorage.ofMachine({ fs: disk, ps, log }),
						env: (name) => ps.env(name),
					},
					() => originOf(ps, dirname(gitDir)),
				);
	const fs =
		relay === null
			? disk
			: new RoutedFs(
					splatesDir,
					new RelayFs(relay.url, relay.project, splatesDir),
					disk,
				);

	// A worker's task clone works against the project clone it was made
	// from, as a worktree does against its main tree.
	const root =
		relay === null
			? dirname(gitDir)
			: await cloneHome(ps, cwd, dirname(gitDir));
	const git = new Git(root, { ps, fs });
	const config = await loadConfig(root, { fs, git });
	const timer = new SystemTimer();
	const lockAt = (path: string): Lock =>
		relay === null
			? new FileLock(path, {
					fs,
					ps,
					log,
					stalenessMs: config.leaseStalenessMs,
				})
			: new RelayLock(path, {
					fs,
					ps,
					log,
					timer,
					stalenessMs: config.leaseStalenessMs,
				});
	// The merge lease: one per repository, kept on the coordinator's disk so
	// it outlives a restart, and beating on either side, so neither judges a
	// long test run on the other's host stale. One whose holder dies is free
	// once its pid is gone on the same host, or its beat is old elsewhere.
	const mergeLease = `${splatesDir}/merge.lock`;
	const lease = new RelayLock(mergeLease, {
		fs,
		ps,
		log,
		timer,
		stalenessMs: config.leaseStalenessMs,
	});
	// Before anything reads or makes a record.
	const format = new Format(splatesDir, {
		fs,
		lock: lockAt(`${splatesDir}/format.lock`),
		log,
	});
	if (creates) {
		await format.create();
	}
	await (migrates ? format.migrate() : format.check());
	// The user's, shared by every repository on this machine: the registry,
	// which only `splates init` writes this one into, and how each task ended.
	const beats =
		relay === null ? null : new LeaseBeat(timer, config.leaseStalenessMs);
	// The one place a project's storage is picked, and the machine's.
	const storage = new FsStorage(splatesDir, fs, { locks: { at: lockAt } });
	const machine = FsStorage.ofMachine({ fs, ps, log });
	const outcomes = new Outcomes(machine);
	// On a worker, the coordinator mints each token its git signs in with.
	const relayed =
		relay === null
			? null
			: new TaskBranches(
					git,
					config,
					new RelayApp(relay.url, relay.project),
					new PlanStore(fs, splatesDir),
				);
	const store = new TaskStore(
		`${splatesDir}/tasks`,
		lockAt(`${splatesDir}/tasks.lock`),
		fs,
	);
	const service = new WorktreeService(git, config, splatesDir, {
		store,
		fs,
		storage,
		ps,
		outcomes,
		adherence: new Adherence(machine, null),
		workerBudget: machine.document("worker-budget.json"),
		leases: beats ?? undefined,
		...(machines === undefined ? {} : { machines }),
		// A remote worker clones each task, the local one keeps worktrees.
		...(relay === null || relayed === null
			? {}
			: {
					clones: {
						checkouts: new CloneCheckouts(git, config, relayed, fs),
						machine: relay.worker ?? ps.hostname,
					},
				}),
	});
	await service.init();
	if (migrates) {
		for (const worktree of await service.list()) {
			await movePlan(worktree.path, PLAN_FILE, fs);
		}
		await new Plans(fs).exclude(gitDir);
	}

	const creds = await Creds.open(
		splatesDir,
		git.root,
		lockAt(`${splatesDir}/creds.lock`),
		secrets,
		{ fs },
	);
	if (migrates) {
		await creds.copyLegacy();
	}

	const projects = Projects.ofMachine({ fs, ps, log }, config.leaseStalenessMs);

	return {
		fs,
		storage,
		machine,
		beats,
		projects,
		branches:
			relayed ??
			TaskBranches.of({
				git,
				config,
				creds,
				plans: new PlanStore(fs, splatesDir),
			}),
		slots: Slots.ofMachine({ fs, ps, log }),
		heavy: heavyJobsOfMachine({ fs, ps, log }),
		creds,
		splatesDir,
		config,
		format,
		git,
		service,
		outcomes,
		lock: lease,
		relayed: relay !== null,
		trunk:
			relay === null
				? new CoordinatorLanding({ git, fs, config, lease: mergeLease })
				: new RelayLanding(relay.url, relay.project),
		shell: new Shell({ ps }),
		journal: new Journal(storage, config.logCapacity, { ps }),
		tasks: new Tasks(store, { fs }),
	};
}

/**
 * The project clone the task clone at `cwd` was made from, as its config
 * names it, or `root`, the checkout's own, for any other.
 */
async function cloneHome(ps: Ps, cwd: string, root: string): Promise<string> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		cwd,
		"config",
		"--get",
		HOME_KEY,
	]);
	return exitCode === 0 && stdout.trim() !== "" ? stdout.trim() : root;
}

/** The URL of `root`'s `origin` remote, or null for none. */
async function originOf(ps: Ps, root: string): Promise<string | null> {
	const { exitCode, stdout } = await ps.spawnCapture([
		"git",
		"-C",
		root,
		"remote",
		"get-url",
		"origin",
	]);
	return exitCode === 0 && stdout.trim() !== "" ? stdout.trim() : null;
}

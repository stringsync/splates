import { dirname } from "node:path";
import type { Deps, Middleware } from "webappwiz/cmd";
import { FileLock, type Fs, type Lock, type Ps } from "webappwiz/system";
import { Adherence } from "./adherence";
import type { Config } from "./config";
import { Creds, type SecretStores, SYSTEM_STORES } from "./creds";
import { fail } from "./exit";
import { Format } from "./format";
import { Git } from "./git";
import { type HeavyCap, HeavyJobs } from "./heavy";
import { Journal } from "./journal";
import { loadConfig } from "./load-config";
import { Outcomes } from "./outcomes";
import { Projects, type Reach, reaches } from "./projects";
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
	/** The machine's slots for test runs and installs, which hooks wait for. */
	heavy: HeavyCap;
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
 * Runs the action against the repository `cwd` sits in, or the registered
 * project `--project` names, and refuses to run it at all when that is not
 * a repository, its records are in a format this arbor does not read, or
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
		const elsewhere = await checkReach(ctx, repo, opts.needs);
		await next({ ...ctx, ...repo, elsewhere });
	};
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
 * granted what it `needs` here. The project acting is the one whose `arbor dev` conversation runs the
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
			: ((await conversationHome(fs, ps.env("ARBOR_CONVERSATION"), projects)) ??
				(project === undefined ? git.root : await mainTree(ps)));
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
				`${called(git.root)} lets ${called(from)} ${reach === "read" ? "only read" : "only add todos"} here, and this needs ${needs}.`,
				`Ask the user whether it may: once they say so, \`arbor projects grant ${called(from)} ${needs}\` run in ${git.root} grants it.`,
			].join("\n"),
			{ from: called(from), to: called(git.root), reach, needs },
		);
	}
	return from;
}

/**
 * The main tree of the registered project whose `arbor dev` conversation
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
		if (await fs.exists(`${each.root}/.git/arbor/conversations/${id}.jsonl`)) {
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
		adherence: new Adherence(`${registry}/adherence.jsonl`, fs, null),
	});
	await service.init();

	const projects = Projects.ofMachine({ fs, ps, log }, config.leaseStalenessMs);

	return {
		projects,
		slots: Slots.ofMachine({ fs, ps, log }),
		heavy: HeavyJobs.ofMachine({ fs, ps, log }),
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

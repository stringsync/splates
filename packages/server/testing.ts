import { afterAll, expect } from "bun:test";
import { mkdirSync } from "node:fs";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { CounterIdProvider } from "webappwiz/id";
import { color, MemoryLogger } from "webappwiz/log";
import { FileLock, NodeFs, NodePs } from "webappwiz/system";
import { FakeProcess } from "webappwiz/system/testing";
import { TaskStore, Tasks } from "./board";
import type { Config } from "./config";
import { Creds, type SecretStores } from "./creds";
import { Exit, type Reason } from "./exit";
import { Git } from "./git";
import { CoordinatorLanding, MergeBatch, TaskBranches } from "./merge";
import { PLAN_FILE, PlanStore } from "./plans";
import { MACHINE_HOME, SLOT, Slots } from "./ports";
import { Projects } from "./projects";
import { Format, Journal, ProjectHome } from "./records";
import { assets } from "./server";
import { PREMERGE_HELD } from "./server/shared";
import { Adherence, Outcomes } from "./stats";
import { FsStorage, SqliteStorage } from "./storage";
import { WorktreeService } from "./tasks";
import { Shell } from "./terminal";

// the machine's own git identity must not reach a test that expects none
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";

/**
 * A throwaway git repo with one commit on `main`, holding every dependency an
 * splates command runs against, wired to it. A command takes the whole thing as
 * its deps: `await add(deps, "alpha")`.
 *
 * It coordinates the dependencies and nothing else. What a test is about, the
 * tasks, the commits, the config it needs to differ, the test does itself.
 */
export class Testing implements AsyncDisposable {
	readonly root: string;
	/**
	 * Where records were kept before the database, `.git/splates`: what the
	 * migrations of those files are tested on, and nothing else is kept in.
	 */
	readonly splatesDir: string;
	/** What the registry names the project's records by, so the database is found where `dir` says. */
	readonly projectId: string;
	/** The project's directory under `splatesHome`: its database and the files beside it. */
	readonly dir: string;
	/** Where the project's records are found, as a command run here finds them. */
	readonly records: ProjectHome;
	readonly fs = new NodeFs();
	/** Spawns for real; its exits and signals are the fake process's to keep. */
	readonly proc = new FakeProcess();
	readonly ps: NodePs;
	readonly log = new MemoryLogger();
	/** Stored file names count up from 0, so a test can name them. */
	readonly ids = new CounterIdProvider();
	// The real ones, which publish: `dev` is tested by serving a page and
	// fetching it, and asserting on what comes back is the point.
	readonly assets = assets;
	/**
	 * What `splates server` serves as it is when handed these deps: this repo, with
	 * its fakes, rather than one it opens again.
	 */
	get opened(): Testing[] {
		return [this];
	}
	/** Arbitrary but valid settings; a test changes what it cares about. */
	readonly config: Config;
	readonly git: Git;
	readonly service: WorktreeService;
	readonly shell: Shell;
	/** The premerge lock a merge under test holds, never the machine's. */
	readonly premerge: FileLock;
	/** Where merges under test form batches, polled fast. */
	readonly batch: MergeBatch;
	readonly journal: Journal;
	/** The project's records, in its database under `dir`. */
	readonly storage: SqliteStorage;
	/** The machine's storage, under `splatesHome`. */
	readonly machine: FsStorage;
	readonly lockPath: string;
	readonly lock: FileLock;
	readonly tasks: Tasks;
	readonly format: Format;
	/** Where splates keeps what is the user's, under the test's own directory. */
	readonly splatesHome: string;
	/** The project registry a test registers its repositories in, under `splatesHome`. */
	readonly projects: Projects;
	/** Where the registry is kept on disk. */
	readonly projectsPath: string;
	/** How each task ended, kept in `splatesHome`. */
	readonly outcomes: Outcomes;
	readonly adherence: Adherence;
	/** The dev slots tasks give back as they end, kept in `splatesHome`. */
	readonly slots: Slots;
	/** The stores a test reads and writes, never the user's. */
	readonly projectStore = new FakeSecretStore({}, "the project's store");
	readonly deviceStore = new FakeSecretStore({}, "the device's store");
	readonly secrets: SecretStores = {
		project: async () => this.projectStore,
		device: this.deviceStore,
	};
	readonly creds: Creds;

	/** Pushes to `config.remote`, read at each push, so a test can set one. */
	readonly branches: TaskBranches;
	/** Lands on `config.remote`'s trunk as the server does. */
	readonly trunk: CoordinatorLanding;

	private constructor(
		private readonly base: string,
		alongside?: Testing,
	) {
		this.root = join(base, "repo");
		this.splatesDir = join(this.root, ".git", "splates");
		this.ps = new NodePs({ proc: this.proc });
		this.config = {
			trunk: "main",
			remote: null,
			worktreeRoot: `${this.root}-splates`,
			notesDir: "notes",
			postCheckout: null,
			postRewrite: null,
			// Keeps merge's gate green unless a test asks otherwise.
			preMerge: "true",
			preLock: null,
			on: {},
			leaseStalenessMs: 90_000,
			removedCapacity: 50,
			finishedCapacity: 500,
			mergeRetryCount: 2,
			mergeConflictCount: 3,
			logCapacity: 200,
			taskStalenessMs: 30 * 24 * 60 * 60 * 1000,
			attachmentCapacity: 100 * 1024 * 1024,
			artifactFileCapacity: 50 * 1024 * 1024,
			artifactConversationCapacity: 250 * 1024 * 1024,
			artifactProjectCapacity: 2 * 1024 * 1024 * 1024,
			wiz: "wiz",
			tunnel: null,
			platform: null,
			replica: null,
		};
		this.git = new Git(this.root, { ps: this.ps, fs: this.fs });
		this.splatesHome = alongside?.splatesHome ?? join(base, "home", ".splates");
		this.projectId = alongside === undefined ? "test" : basename(base);
		this.dir = join(this.splatesHome, "projects", this.projectId);
		mkdirSync(this.dir, { recursive: true });
		this.storage = SqliteStorage.open(join(this.dir, "state.db"), {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
		});
		this.machine = new FsStorage(this.splatesHome, this.fs);
		this.outcomes = new Outcomes(this.machine);
		this.adherence = new Adherence(this.machine, null, this.fs);
		const store = new TaskStore(this.storage);
		this.service = new WorktreeService(this.git, this.config, this.dir, {
			store,
			fs: this.fs,
			storage: this.storage,
			ps: this.ps,
			outcomes: this.outcomes,
			adherence: this.adherence,
		});
		this.shell = new Shell({ ps: this.ps });
		this.premerge = new FileLock(join(this.splatesHome, "premerge.lock"), {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
		});
		this.batch = new MergeBatch(this.storage, this.ps, this.log, {
			pollMs: 20,
			replyMs: 5000,
		});
		this.journal = new Journal(this.storage, this.config.logCapacity, {
			ps: this.ps,
		});
		this.lockPath = join(this.dir, "merge.lock");
		this.lock = new FileLock(this.lockPath, {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
			stalenessMs: this.config.leaseStalenessMs,
		});
		this.tasks = new Tasks(store, { ids: this.ids });
		// So a command run here, or a CLI it spawns, registers the test's
		// repository in the test's registry rather than the user's. Run from an
		// agent in `splates server`, it leaves out that agent's conversation too, so
		// a command's `follow` never reaches the live server, nor its caller
		// refuses the test an `--agent`.
		// Run from a slot's server, it leaves out the machine's home too, so no
		// task ending here gives back a slot of the user's.
		// Run on a worker, it leaves out that too, so a test is no worker until it says so.
		// Nor does it pass through the premerge lock a gate it runs in holds.
		const {
			SPLATES_CONVERSATION,
			SPLATES_STARTED_BY,
			SPLATES_DEV,
			SPLATES_PROJECT,
			SPLATES_WORKER,
			[MACHINE_HOME]: _machine,
			[SLOT]: _slot,
			[PREMERGE_HELD]: _premerge,
			SPLATES_CORES: _cores,
			...inherited
		} = process.env;
		// The same under their old `ARBOR_*` names, which splates still reads.
		this.proc.env = {
			...Object.fromEntries(
				Object.entries(inherited).filter(([key]) => !key.startsWith("ARBOR_")),
			),
			SPLATES_HOME: this.splatesHome,
		};
		this.slots = Slots.ofMachine(this);
		this.projectsPath = join(this.splatesHome, "projects.json");
		this.projects = Projects.in(
			FsStorage.ofMachine({
				fs: this.fs,
				ps: this.ps,
				log: this.log,
				home: this.splatesHome,
			}),
			this.fs,
		);
		this.creds = new Creds(this.storage, {
			project: this.projectStore,
			device: this.deviceStore,
		});
		this.branches = TaskBranches.of({
			...this,
			plans: new PlanStore(this.fs, this.storage),
		});
		this.trunk = new CoordinatorLanding({
			git: this.git,
			fs: this.fs,
			config: this.config,
			lease: this.lockPath,
		});
		this.records = new ProjectHome(this.root, {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
			projects: this.projects,
		});
		this.format = new Format(this.splatesDir, {
			fs: this.fs,
			lock: new FileLock(join(this.splatesDir, "format.lock"), {
				fs: this.fs,
				ps: this.ps,
				log: this.log,
			}),
			log: this.log,
			database: this.records.stamp(),
			into: this.records,
		});
	}

	/**
	 * A repo of its own, seeded and ready for a command: made a splates project
	 * as `splates init` does, unless `init` is false.
	 */
	static async open({
		init = true,
		alongside,
	}: {
		init?: boolean;
		/**
		 * Another test's project, on whose machine this one is: they share
		 * its splates home and so its registry, as two projects on one machine do.
		 */
		alongside?: Testing;
	} = {}): Promise<Testing> {
		const base = await realpath(await mkdtemp(join(tmpdir(), "splates-")));
		const testing = new Testing(base, alongside);
		await cp(await seeded(), testing.root, { recursive: true });
		// So a command run here finds the very database `storage` is.
		await testing.fs.mkdir(testing.splatesHome, { recursive: true });
		const registry = await testing.fs
			.read(testing.projectsPath)
			.then((text) => JSON.parse(text))
			.catch(() => ({ format: 2, projects: [], focused: [], ids: {} }));
		await testing.fs.write(
			testing.projectsPath,
			JSON.stringify({
				...registry,
				ids: { ...registry.ids, [testing.root]: testing.projectId },
			}),
		);
		if (init) {
			await testing.format.create();
			await testing.service.init();
			await testing.projects.register(testing.root);
		}
		return testing;
	}

	/**
	 * Runs git in `cwd`, named apart from the `git` a command is handed. It
	 * signs as an identity of its own, so a commit in a clone works on a
	 * machine with none configured.
	 */
	async gitCli(cwd: string, ...args: string[]): Promise<string> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture(
			["git", "-C", cwd, ...args],
			{
				env: {
					GIT_AUTHOR_NAME: "splates",
					GIT_AUTHOR_EMAIL: "splates@example.com",
					GIT_COMMITTER_NAME: "splates",
					GIT_COMMITTER_EMAIL: "splates@example.com",
				},
			},
		);
		if (exitCode !== 0) {
			throw new Error(`git ${args.join(" ")}: ${stderr}`);
		}
		return stdout.trim();
	}

	/** Writes a file in `cwd` and commits it. */
	async commit(
		cwd: string,
		file: string,
		content: string,
		message: string,
	): Promise<void> {
		await this.fs.write(join(cwd, file), content);
		await this.gitCli(cwd, "add", file);
		await this.gitCli(cwd, "commit", "-m", message);
	}

	/**
	 * Checks off every step under `## Next` in the plan at `cwd`, as an agent
	 * does once its work is done, so the task is ready to merge.
	 */
	async finish(cwd: string): Promise<void> {
		const path = join(cwd, PLAN_FILE);
		const plan = await this.fs.read(path).catch(() => null);
		if (plan === null) {
			return;
		}
		let next = false;
		const lines = plan.split("\n").map((line) => {
			if (line.startsWith("## ")) {
				next = line.trim() === "## Next";
			}
			return next ? line.replace(/^(\s*)- \[ \]/, "$1- [x]") : line;
		});
		await this.fs.write(path, lines.join("\n"));
	}

	/**
	 * The tasks and service as they read the old files under `splatesDir`,
	 * which is what a migration of those files is checked against.
	 */
	legacyRecords(): { service: WorktreeService; tasks: Tasks } {
		const storage = new FsStorage(this.splatesDir, this.fs);
		const store = new TaskStore(storage);
		return {
			service: new WorktreeService(this.git, this.config, this.splatesDir, {
				store,
				fs: this.fs,
				storage,
				ps: this.ps,
			}),
			tasks: new Tasks(store, { ids: this.ids }),
		};
	}

	/** The record kept at `key` in the project's storage as text, or null for none. */
	readRecord(key: string): Promise<string | null> {
		const at = key.lastIndexOf("/");
		return this.storage
			.collection(at < 0 ? "" : key.slice(0, at))
			.read(key.slice(at + 1));
	}

	/** Keeps `text` as the record at `key` in the project's storage. */
	writeRecord(key: string, text: string): Promise<void> {
		const at = key.lastIndexOf("/");
		return this.storage
			.collection(at < 0 ? "" : key.slice(0, at))
			.write(key.slice(at + 1), text);
	}

	/** Replaces the log at `key` with the JSON lines of `text`, as a file written whole would. */
	async writeLog(key: string, text: string): Promise<void> {
		await this.storage.log(key).remove();
		await this.appendLog(key, text);
	}

	/** Appends the JSON lines of `text` to the log at `key`, as a store earlier than this one's wrote them. */
	async appendLog(key: string, text: string): Promise<void> {
		const lines = text.split("\n").filter((line) => line !== "");
		await this.storage
			.log(key)
			.append(...lines.map((line): unknown => JSON.parse(line)));
	}

	/** The key of the record of started task `task`, under its number. */
	async recordOf(task: string): Promise<string> {
		const { state } = await this.service.find(task);
		return `tasks/${state?.id}.md`;
	}

	/** Everything logged so far, one line each, without colour. */
	out(): string {
		return color.strip(
			this.log.entries.map((entry) => String(entry.message)).join("\n"),
		);
	}

	/** Deletes the repo, its worktrees and the temporary directory holding them. */
	disposeAsync(): Promise<void> {
		this.storage.dispose();
		return rm(this.base, { recursive: true, force: true });
	}

	// so a concurrent test can own its repo with `await using`, instead of
	// afterEach handing every test in the file the same one
	[Symbol.asyncDispose](): Promise<void> {
		return this.disposeAsync();
	}

	/** Makes the repo every test starts from, with one commit on `main`. */
	static async seed(base: string): Promise<void> {
		const testing = new Testing(base);
		const { root } = testing;
		await testing.fs.mkdir(root);
		await testing.gitCli(root, "init", "-b", "main");
		await testing.gitCli(root, "config", "user.email", "splates@example.com");
		await testing.gitCli(root, "config", "user.name", "splates");
		await testing.gitCli(root, "config", "commit.gpgsign", "false");
		await testing.commit(root, "README.md", "seed\n", "seed");
	}
}

/** Where the seeded repo lives: made at the first test, gone after the last. */
// scry-ignore tests-own-their-state: each test copies it, so none shares the repo itself
let template: Promise<string> | null = null;

/**
 * The seeded repo, made once per test file and copied for each test: its six
 * git spawns were most of what a concurrent suite spent, and with several
 * test runs at once, enough to time the slowest tests out.
 */
async function seeded(): Promise<string> {
	template ??= (async () => {
		const base = await realpath(await mkdtemp(join(tmpdir(), "splates-seed-")));
		await Testing.seed(base);
		return base;
	})();
	return join(await template, "repo");
}

// registered here, outside any describe, so it runs once the importing file's
// tests are done
afterAll(async () => {
	if (template !== null) {
		await rm(await template, { recursive: true, force: true });
		template = null;
	}
});

/** pid 1 always exists, so it stands in for another agent that is still running. */
export const LIVE_PID = 1;

/** What a refusal carries beyond its reason, when a test says. */
export interface BailOptions {
	/** A fragment of the message the person reading it gets, or every one. */
	message?: string | string[];
	/** Everything the refusal reports alongside the reason. */
	data?: Record<string, unknown>;
}

declare module "bun:test" {
	interface Matchers<T> {
		/** Asserts the work refuses: `await expect(add(t, "x")).toBail("usage")`. */
		toBail(reason: Reason, expected?: BailOptions): Promise<void>;
	}
}

// Registered here because every test file that asserts a refusal already
// imports `Testing`, and `expect.extend` has to have run before the first one.
expect.extend({
	async toBail(work, reason, expected = {}) {
		let exit: Exit | null;
		try {
			exit = await refusal(work);
		} catch (error) {
			return {
				pass: false,
				message: () =>
					`expected a ${reason} refusal, but it rejected with ${this.utils.printReceived(error)}`,
			};
		}
		if (exit === null) {
			return {
				pass: false,
				message: () => `expected a ${reason} refusal, but it succeeded`,
			};
		}
		if (exit.reason !== reason) {
			return {
				pass: false,
				message: () =>
					`expected a ${reason} refusal, got ${exit.reason}: ${exit.message}`,
			};
		}
		const fragments = [expected.message ?? []].flat();
		const missing = fragments.filter((text) => !exit.message.includes(text));
		if (missing.length > 0) {
			return {
				pass: false,
				message: () =>
					`expected the ${reason} message to contain ${this.utils.printExpected(missing)}, got ${this.utils.printReceived(exit.message)}`,
			};
		}
		if (expected.data !== undefined && !this.equals(exit.data, expected.data)) {
			return {
				pass: false,
				message: () =>
					`expected the ${reason} data to be ${this.utils.printExpected(expected.data)}, got ${this.utils.printReceived(exit.data)}`,
			};
		}
		return { pass: true, message: () => `expected no ${reason} refusal` };
	},
});

/**
 * The `Exit` some work refused with, or null when it did not refuse. Anything
 * else it threw is a real failure and is left to blow up the test as itself.
 */
async function refusal(work: unknown): Promise<Exit | null> {
	try {
		await work;
		return null;
	} catch (entry) {
		if (entry instanceof Exit) {
			return entry;
		}
		throw entry;
	}
}

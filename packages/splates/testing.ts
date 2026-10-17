import { afterAll, expect } from "bun:test";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeSecretStore } from "webappwiz/creds/testing";
import { CounterIdProvider } from "webappwiz/id";
import { color, MemoryLogger } from "webappwiz/log";
import { FileLock, HeavyJobs, NodeFs, NodePs } from "webappwiz/system";
import { FakeProcess } from "webappwiz/system/testing";
import { Adherence } from "./adherence";
import type { Config } from "./config";
import { Creds, type SecretStores } from "./creds";
import { Exit, type Reason } from "./exit";
import { Format } from "./format";
import { Git } from "./git";
import { HEAVY_HELD } from "./heavy";
import { Journal } from "./journal";
import { Outcomes } from "./outcomes";
import { PLAN_FILE } from "./plan";
import { Projects } from "./projects";
import { Shell } from "./shell";
import { MACHINE_HOME, SLOT, Slots } from "./slots";
import { TaskBranches } from "./task-branches";
import { Todos } from "./todos";
import { assets } from "./web/assets";
import { WorktreeService } from "./worktree-service";

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
	readonly splatesDir: string;
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
	/** Kept in `splatesHome`, so no test waits on the machine's own jobs. */
	readonly heavy: HeavyJobs;
	readonly journal: Journal;
	readonly lockPath: string;
	readonly lock: FileLock;
	readonly todos: Todos;
	readonly format: Format;
	/** Where splates keeps what is the user's, under the test's own directory. */
	readonly splatesHome: string;
	/** Kept in `splatesHome`, never the user's home. */
	readonly projects: Projects;
	/** How each task ended, kept in `splatesHome`. */
	readonly outcomes: Outcomes;
	readonly adherence: Adherence;
	/** The dev slots tasks give back as they end, kept in `splatesHome`. */
	readonly slots: Slots;
	/** Maps for the system's stores, so no test reads or writes the user's. */
	readonly projectStore = new FakeSecretStore({}, "the project's store");
	readonly deviceStore = new FakeSecretStore({}, "the device's store");
	readonly secrets: SecretStores = {
		project: async () => this.projectStore,
		device: this.deviceStore,
	};
	readonly creds: Creds;

	/** Pushes to `config.remote`, read at each push, so a test can set one. */
	readonly branches: TaskBranches;

	private constructor(private readonly base: string) {
		this.root = join(base, "repo");
		this.splatesDir = join(this.root, ".git", "splates");
		this.ps = new NodePs({ proc: this.proc });
		this.config = {
			trunk: "main",
			remote: null,
			worktreeRoot: `${this.root}-splates`,
			postCheckout: null,
			postRewrite: null,
			// Keeps merge's gate green unless a test asks otherwise.
			preMerge: "true",
			leaseStalenessMs: 90_000,
			removedCapacity: 50,
			agentsPerAgent: 15,
			mergeRetryCount: 2,
			logCapacity: 200,
			todoStalenessMs: 30 * 24 * 60 * 60 * 1000,
			attachmentCapacity: 100 * 1024 * 1024,
			artifactFileCapacity: 50 * 1024 * 1024,
			artifactConversationCapacity: 250 * 1024 * 1024,
			artifactProjectCapacity: 2 * 1024 * 1024 * 1024,
			wiz: "wiz",
			tunnel: null,
		};
		this.git = new Git(this.root, { ps: this.ps, fs: this.fs });
		this.splatesHome = join(base, "home", ".splates");
		this.outcomes = new Outcomes(
			join(this.splatesHome, "outcomes.jsonl"),
			this.fs,
		);
		this.adherence = new Adherence(
			join(this.splatesHome, "adherence.jsonl"),
			this.fs,
			null,
		);
		this.service = new WorktreeService(this.git, this.config, this.splatesDir, {
			fs: this.fs,
			ps: this.ps,
			outcomes: this.outcomes,
			adherence: this.adherence,
		});
		this.shell = new Shell({ ps: this.ps });
		this.heavy = HeavyJobs.under(this.splatesHome, {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
			cap: 2,
			held: HEAVY_HELD,
		});
		this.journal = new Journal(
			join(this.splatesDir, "log.jsonl"),
			this.config.logCapacity,
			{ fs: this.fs, ps: this.ps },
		);
		this.lockPath = join(this.splatesDir, "merge.lock");
		this.lock = new FileLock(this.lockPath, {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
			stalenessMs: this.config.leaseStalenessMs,
		});
		this.todos = new Todos(
			join(this.splatesDir, "todos"),
			new FileLock(join(this.splatesDir, "todos.lock"), {
				fs: this.fs,
				ps: this.ps,
				log: this.log,
			}),
			{ fs: this.fs, ids: this.ids },
		);
		// So a command run here, or a CLI it spawns, registers the test's
		// repository in the test's registry rather than the user's. Run from an
		// agent in `splates server`, it leaves out that agent's conversation too, so
		// a command's `follow` never reaches the live server, nor its caller
		// refuses the test an `--agent`.
		// Run from a slot's server, it leaves out the machine's home too, so no
		// task ending here gives back a slot of the user's.
		// Nor does it wait on, or pass through, a heavy-job slot of the machine's.
		const {
			SPLATES_CONVERSATION,
			SPLATES_CALLER,
			SPLATES_STARTED_BY,
			SPLATES_DEV,
			[MACHINE_HOME]: _machine,
			[SLOT]: _slot,
			SPLATES_HEAVY,
			...inherited
		} = process.env;
		this.proc.env = { ...inherited, SPLATES_HOME: this.splatesHome };
		this.slots = Slots.ofMachine(this);
		this.projects = new Projects(join(this.splatesHome, "projects.json"), {
			fs: this.fs,
			lock: new FileLock(join(this.splatesHome, "projects.lock"), {
				fs: this.fs,
				ps: this.ps,
				log: this.log,
			}),
		});
		this.creds = new Creds(
			join(this.splatesDir, "creds.json"),
			new FileLock(join(this.splatesDir, "creds.lock"), {
				fs: this.fs,
				ps: this.ps,
				log: this.log,
			}),
			{ project: this.projectStore, device: this.deviceStore },
			{ fs: this.fs },
		);
		this.branches = TaskBranches.of(this);
		this.format = new Format(this.splatesDir, {
			fs: this.fs,
			lock: new FileLock(join(this.splatesDir, "format.lock"), {
				fs: this.fs,
				ps: this.ps,
				log: this.log,
			}),
			log: this.log,
		});
	}

	/**
	 * A repo of its own, seeded and ready for a command: made a splates project
	 * as `splates init` does, unless `init` is false.
	 */
	static async open({
		init = true,
	}: {
		init?: boolean;
	} = {}): Promise<Testing> {
		const base = await realpath(await mkdtemp(join(tmpdir(), "splates-")));
		const testing = new Testing(base);
		await cp(await seeded(), testing.root, { recursive: true });
		if (init) {
			await testing.format.create();
			await testing.service.init();
			await testing.projects.register(testing.root);
		}
		return testing;
	}

	/** Runs git in `cwd`, named apart from the `git` a command is handed. */
	async gitCli(cwd: string, ...args: string[]): Promise<string> {
		const { exitCode, stdout, stderr } = await this.ps.spawnCapture([
			"git",
			"-C",
			cwd,
			...args,
		]);
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

	/** Everything logged so far, one line each, without colour. */
	out(): string {
		return color.strip(
			this.log.entries.map((entry) => String(entry.message)).join("\n"),
		);
	}

	/** Deletes the repo, its worktrees and the temporary directory holding them. */
	disposeAsync(): Promise<void> {
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
		const exit = await refusal(work);
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

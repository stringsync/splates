import { expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunHttpServer } from "webappwiz/http/bun";
import { color, MemoryLogger } from "webappwiz/log";
import { FileLock, NodeFs, NodePs } from "webappwiz/system";
import { FakeProcess } from "webappwiz/system/testing";
import type { Config } from "./config";
import { assets } from "./dev/assets";
import { Exit, type Reason } from "./exit";
import { Git } from "./git";
import { Journal } from "./journal";
import { Shell } from "./shell";
import { WorktreeService } from "./worktree-service";

/**
 * A throwaway git repo with one commit on `main`, holding every dependency an
 * arbor command runs against, wired to it. A command takes the whole thing as
 * its deps: `await add(deps, "alpha")`.
 *
 * It coordinates the dependencies and nothing else. What a test is about, the
 * tasks, the commits, the config it needs to differ, the test does itself.
 */
export class Testing implements AsyncDisposable {
	readonly root: string;
	readonly arborDir: string;
	readonly fs = new NodeFs();
	/** Spawns for real; its exits and signals are the fake process's to keep. */
	readonly proc = new FakeProcess();
	readonly ps: NodePs;
	readonly log = new MemoryLogger();
	// The real ones: `dev` is tested by serving a page and fetching it, so a
	// stand-in would only have to grow into these. The assets are the ones that
	// publish, which is the point of asserting on what comes back.
	readonly http = new BunHttpServer();
	readonly assets = assets;
	/** Arbitrary but valid settings; a test changes what it cares about. */
	readonly config: Config;
	readonly git: Git;
	readonly service: WorktreeService;
	readonly shell: Shell;
	readonly journal: Journal;
	readonly lockPath: string;
	readonly lock: FileLock;

	private constructor(private readonly base: string) {
		this.root = join(base, "repo");
		this.arborDir = join(this.root, ".git", "arbor");
		this.ps = new NodePs({ proc: this.proc });
		this.config = {
			trunk: "main",
			worktreeRoot: `${this.root}-arbor`,
			postCheckout: null,
			postRewrite: null,
			// Keeps merge's gate green unless a test asks otherwise.
			preMerge: "true",
			postMerge: null,
			leaseStalenessMs: 90_000,
			removedCapacity: 50,
			mergeRetryCount: 2,
			logCapacity: 200,
		};
		this.git = new Git(this.root, { ps: this.ps, fs: this.fs });
		this.service = new WorktreeService(this.git, this.config, this.arborDir, {
			fs: this.fs,
			ps: this.ps,
		});
		this.shell = new Shell({ ps: this.ps });
		this.journal = new Journal(
			join(this.arborDir, "log.jsonl"),
			this.config.logCapacity,
			{ fs: this.fs },
		);
		this.lockPath = join(this.arborDir, "merge.lock");
		this.lock = new FileLock(this.lockPath, {
			fs: this.fs,
			ps: this.ps,
			log: this.log,
			stalenessMs: this.config.leaseStalenessMs,
		});
	}

	/** A repo of its own, seeded and ready for a command. */
	static async open(): Promise<Testing> {
		const base = await realpath(await mkdtemp(join(tmpdir(), "arbor-")));
		const testing = new Testing(base);
		await testing.seed();
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

	private async seed(): Promise<void> {
		await this.fs.mkdir(this.root);
		await this.gitCli(this.root, "init", "-b", "main");
		await this.gitCli(this.root, "config", "user.email", "arbor@example.com");
		await this.gitCli(this.root, "config", "user.name", "arbor");
		await this.gitCli(this.root, "config", "commit.gpgsign", "false");
		await this.commit(this.root, "README.md", "seed\n", "seed");
		await this.service.init();
	}
}

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

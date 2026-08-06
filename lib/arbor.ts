import { basename, dirname, resolve } from "node:path";
import type { Logger } from "@webappwiz/log";
import { FileLock, type Fs, type Lock, type Ps } from "@webappwiz/sys";
import { EXIT, Exit, type Reason } from "./exit";
import { Git } from "./git";
import { Shell } from "./shell";
import { WorktreeStore } from "./worktree-store";

export interface Config {
	/** What `graft` runs after rebasing, via `sh -c`. */
	testCommand: string;
	trunk: string;
	worktreeRoot: string;
	portRange: [number, number];
	/** Command run by `create` in the new worktree, via `sh -c`. */
	postCreate: string | null;
	leaseStalenessMs: number;
	graftRetryBudget: number;
}

/**
 * The composition root. Commands get one of these and talk to its
 * collaborators; nothing below this line touches `Fs` or `Ps` directly.
 */
export class Arbor {
	constructor(
		readonly log: Logger,
		private readonly ps: Ps,
		readonly config: Config,
		readonly git: Git,
		readonly store: WorktreeStore,
		readonly lock: Lock,
		readonly shell: Shell,
	) {}

	/** Wires everything up against a real repository. */
	static async open(
		fs: Fs,
		ps: Ps,
		log: Logger,
		cwd: string = process.cwd(),
	): Promise<Arbor> {
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
		const root = dirname(gitDir);
		const arborDir = `${gitDir}/arbor`;

		const config = { ...(await defaults(fs, root)), ...(await file(fs, root)) };
		const git = new Git(ps, fs, root);
		const worktrees = new WorktreeStore(fs, ps, git, config, arborDir);
		await worktrees.init();

		return new Arbor(
			log,
			ps,
			config,
			git,
			worktrees,
			new FileLock(fs, ps, log, `${arborDir}/graft.lock`, {
				stalenessMs: config.leaseStalenessMs,
			}),
			new Shell(ps),
		);
	}

	/** Machine-readable reason on stdout, human explanation on stderr. */
	fail(
		reason: Reason,
		message: string,
		data: Record<string, unknown> = {},
	): never {
		this.log.info(JSON.stringify({ reason, ...data }));
		this.log.error(message);
		this.ps.exit(EXIT[reason]);
		throw new Exit(EXIT[reason], reason);
	}
}

async function defaults(fs: Fs, root: string): Promise<Config> {
	return {
		testCommand: (await hasTestScript(fs, root)) ? "bun run test" : "bun test",
		trunk: "main",
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		portRange: [3100, 3199],
		postCreate: null,
		leaseStalenessMs: 90_000,
		graftRetryBudget: 2,
	};
}

async function hasTestScript(fs: Fs, root: string): Promise<boolean> {
	const raw = await fs.read(`${root}/package.json`).catch(() => "{}");
	try {
		return typeof JSON.parse(raw)?.scripts?.test === "string";
	} catch {
		return false;
	}
}

async function file(fs: Fs, root: string): Promise<Partial<Config>> {
	const path = `${root}/arbor.config.ts`;
	if (!(await fs.exists(path))) {
		return {};
	}
	const mod = (await import(path)) as { default?: Partial<Config> };
	return mod.default ?? {};
}

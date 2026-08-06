import { basename, dirname, resolve } from "node:path";
import type { Logger } from "@webappwiz/log";
import type { Fs, Ps } from "@webappwiz/sys";

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

export interface Ctx {
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** The main worktree's root — where trunk lives. */
	root: string;
	/** `.git` shared by every worktree. */
	gitDir: string;
	arborDir: string;
	tasksDir: string;
	prunedDir: string;
	lockPath: string;
	config: Config;
}

export async function load(
	fs: Fs,
	ps: Ps,
	log: Logger,
	cwd: string = process.cwd(),
): Promise<Ctx> {
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
	const gitDir = stdout.trim();
	// The common dir is <main worktree>/.git, so its parent is the main root.
	const root = dirname(gitDir);
	const arborDir = `${gitDir}/arbor`;
	await fs.mkdir(`${arborDir}/tasks`);
	await fs.mkdir(`${arborDir}/pruned`);

	return {
		fs,
		ps,
		log,
		root,
		gitDir,
		arborDir,
		tasksDir: `${arborDir}/tasks`,
		prunedDir: `${arborDir}/pruned`,
		lockPath: `${arborDir}/graft.lock`,
		config: { ...(await defaults(fs, root)), ...(await file(fs, root)) },
	};
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

/** Deterministic so a task keeps its port across restarts and machines. */
export function portFor(task: string, [start, end]: [number, number]): number {
	let hash = 0;
	for (const char of task) {
		hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	}
	return start + (hash % (end - start + 1));
}

export function worktreeFor(ctx: Ctx, task: string): string {
	return resolve(ctx.config.worktreeRoot, task);
}

export function branchFor(task: string): string {
	return `task/${task}`;
}

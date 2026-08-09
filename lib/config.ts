import { basename, resolve } from "node:path";
import type { Fs } from "@webappwiz/sys";

export interface Config {
	/** What `graft` runs after rebasing, via `sh -c`. */
	testCommand: string;
	/**
	 * The integration branch name. `graft` rebases a task onto this branch and
	 * then fast-forwards it to the result; new worktrees start from it.
	 */
	trunk: string;
	/** Directory holding one worktree per task, a sibling of the repo. */
	worktreeRoot: string;
	/** Command run by `create` in the new worktree, via `sh -c`. */
	postCreate: string | null;
	/** How long since its last heartbeat before a task's lease is up for grabs. */
	leaseStalenessMs: number;
	/** Failed `graft` attempts a task gets before it must escalate or be pruned. */
	graftRetryCount: number;
	/**
	 * How many pruned task names to keep, so `prune` can say "already pruned"
	 * rather than "never existed". A flat cap with no age policy: losing the
	 * oldest costs a nicer message and nothing else.
	 */
	pruneStorageCapacity: number;
	/** How many entries `arbor log` keeps before the oldest fall off. */
	logCapacity: number;
}

/** Defaults for this repo, overridden by whatever `arbor.config.ts` sets. */
export async function loadConfig(fs: Fs, root: string): Promise<Config> {
	return { ...(await defaults(fs, root)), ...(await file(fs, root)) };
}

async function defaults(fs: Fs, root: string): Promise<Config> {
	return {
		testCommand: (await hasTestScript(fs, root)) ? "bun run test" : "bun test",
		trunk: "main",
		worktreeRoot: resolve(root, "..", `${basename(root)}-arbor`),
		postCreate: null,
		leaseStalenessMs: 90_000,
		graftRetryCount: 2,
		pruneStorageCapacity: 50,
		logCapacity: 200,
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

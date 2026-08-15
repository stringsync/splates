export interface Config {
	/**
	 * The integration branch name. `merge` rebases a task onto this branch and
	 * then fast-forwards it to the result; new worktrees start from it.
	 */
	trunk: string;
	/** Directory holding one worktree per task, a sibling of the repo. */
	worktreeRoot: string;
	/** Command run by `add` in the new worktree, via `sh -c`. */
	postCheckout: string | null;
	/**
	 * Command run by `merge` after the rebase, before `preMerge`, via `sh -c`.
	 * A rebase can bring in a dependency the worktree has never installed, and
	 * whatever `preMerge` runs needs it.
	 */
	postRewrite: string | null;
	/**
	 * Command run by `merge` after the rebase, via `sh -c`. The last gate before
	 * the branch lands: a nonzero exit rolls the branch back and leaves the base
	 * untouched. Tests are the obvious thing to put here, but arbor has no
	 * opinion; a repo with nothing to run leaves it null and merges on a green
	 * rebase alone.
	 */
	preMerge: string | null;
	/** How long since its last heartbeat before a task's lease is up for grabs. */
	leaseStalenessMs: number;
	/** Failed `merge` attempts a task gets before it must escalate or be removed. */
	mergeRetryCount: number;
	/**
	 * How many removed task names to keep, so `rm` can say "already removed"
	 * rather than "never existed". A flat cap with no age policy: losing the
	 * oldest costs a nicer message and nothing else.
	 */
	removedCapacity: number;
	/** How many entries `arbor log` keeps before the oldest fall off. */
	logCapacity: number;
}

/**
 * Identity, for the types. `export default defineConfig({ ... })` in
 * `arbor.config.ts` gets the key names and their types checked, and completion
 * while writing it; a bare object literal gets neither.
 */
export function defineConfig(config: Partial<Config>): Partial<Config> {
	return config;
}

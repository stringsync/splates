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
	 * How many removed task names to keep, so `remove` can say "already removed"
	 * rather than "never existed". A flat cap with no age policy: losing the
	 * oldest costs a nicer message and nothing else.
	 */
	removedCapacity: number;
	/** How many entries `arbor log` keeps before the oldest fall off. */
	logCapacity: number;
	/**
	 * How long a todo can wait before `merge` stops recommending it and offers
	 * it for removal instead: work deferred that long has usually been done
	 * some other way, or stopped mattering.
	 */
	todoStalenessMs: number;
	/**
	 * How many bytes of files `arbor attach` lets one task hold, all of them
	 * together: a screen recording is the one thing here that grows fast.
	 */
	attachmentCapacity: number;
}

/**
 * What `arbor.config.ts` exports as its default, typed by a type-only import
 * so a reader can import the file without arbor installed:
 *
 * ```ts
 * import type { ConfigFile } from "@webappwiz/arbor/config";
 *
 * export default { preMerge: "bun test" } satisfies ConfigFile;
 * ```
 */
export type ConfigFile = Partial<Config>;

/**
 * Identity, for the types: what configs called before `ConfigFile`, kept so
 * they still load for `arbor update` to rewrite.
 *
 * @deprecated `satisfies ConfigFile` instead.
 */
export function defineConfig(config: Partial<Config>): Partial<Config> {
	return config;
}

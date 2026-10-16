import type { TunnelProvider } from "./tunnel-provider";

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
	/**
	 * How many tasks handed to agents of their own, by `arbor add --agent`,
	 * may be out at once: a lane orchestrator hands out every todo that can
	 * go, and each starts an agent. Past it, `add --agent` refuses, unless
	 * the person asked for more and it passes `--over-capacity`.
	 */
	agentCapacity: number;
	/** Failed `merge` attempts a task gets before it must escalate or be removed. */
	mergeRetryCount: number;
	/**
	 * How many removed task names to keep, so `remove` can say "already removed"
	 * rather than "never existed". A flat cap with no age policy: losing the
	 * oldest costs a nicer message and nothing else.
	 */
	removedCapacity: number;
	/**
	 * How many events the log holds before it is moved aside and a fresh one
	 * starts; moved files are kept for `LOG_KEPT_MS` (`journal.ts`).
	 */
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
	/**
	 * The command the `arbor dev` Budget page runs `scry budgets` with, from
	 * the repo's root. Leave it unset when the repo installs `@webappwiz/cli`;
	 * name a wrapper of the repo's own otherwise, like `"./bin/wiz"`.
	 */
	wiz: string;
	/**
	 * What carries `arbor dev --tunnel` to its public host, a TunnelProvider
	 * of your own for any tunnel; null runs `cloudflared`.
	 */
	tunnel: TunnelProvider | null;
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

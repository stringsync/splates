import type { TaskEventName } from "../hooks";
import type { TunnelProvider } from "../tunnel";
import type { WorkerProvider } from "../workers";

export interface Config {
	/**
	 * The integration branch name. `merge` rebases a task onto this branch and
	 * then fast-forwards it to the result; new worktrees start from it.
	 */
	trunk: string;
	/**
	 * The git remote each task's branch is pushed to as `splates/<task>`,
	 * after every commit and at every checkpoint, so a task outlives the
	 * machine it runs on: the project's GitHub origin, as `"origin"`. With
	 * one, trunk is the remote's: a merge rebases onto it and the
	 * server alone pushes it. Unset, it is `"origin"` where the
	 * server is deployed or being and `origin` is an SSH URL, and null
	 * elsewhere, which pushes nothing, so tasks live on this machine alone;
	 * `null` set here keeps it so everywhere.
	 */
	remote: string | null;
	/** Directory holding one worktree per task, a sibling of the repo. */
	worktreeRoot: string;
	/** Directory of project notes, relative to the checkout root unless absolute. */
	notesDir: string;
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
	 * untouched. Tests are the obvious thing to put here, but splates has no
	 * opinion; a repo with nothing to run leaves it null and merges on a green
	 * rebase alone.
	 *
	 * To have `merge` queue a task for each test slower than 5 seconds, write a
	 * JUnit XML report to the path in `$SPLATES_TEST_REPORT`, as `bun test
	 * --reporter=junit --reporter-outfile="$SPLATES_TEST_REPORT"` does.
	 * A Bun report also enables selective failure attribution: only failures
	 * reproduced with the task after passing on its base spend an attempt.
	 * Missing reports and inconclusive retests hold the merge without charging.
	 */
	preMerge: string | null;
	/**
	 * Commands run on task events, via `sh -c` in the main tree, with the
	 * event in `$SPLATES_EVENT`, its tasks' numbers in `$SPLATES_TASKS`, comma
	 * separated, and the started task's name, if any, in `$SPLATES_TASK`:
	 * `{ "task.done": "./notify-team" }`. Checked in, so shell commands only;
	 * an agent hook spends its person's tokens, so each person sets their own
	 * from the Setup page or `splates hook add`.
	 */
	on: Partial<Record<TaskEventName, string>>;
	/** How long since its last heartbeat before a task's lease is up for grabs. */
	leaseStalenessMs: number;
	/** Failed `merge` attempts a task gets before only a person's `splates retry` lets it try again. */
	mergeRetryCount: number;
	/**
	 * How many removed task names to keep, so `remove` can say "already removed"
	 * rather than "never existed". A flat cap with no age policy: losing the
	 * oldest costs a nicer message and nothing else.
	 */
	removedCapacity: number;
	/**
	 * How many finished tasks to keep, each with the `SPLATES.md` it ended on,
	 * for the Tasks page's Finished list, which shows every one kept. The
	 * oldest to finish goes first.
	 */
	finishedCapacity: number;
	/**
	 * How many events the log holds before it is moved aside and a fresh one
	 * starts; moved files are kept for `LOG_KEPT_MS` (`journal.ts`).
	 */
	logCapacity: number;
	/**
	 * How long a queued task can wait before `merge` stops recommending it and offers
	 * it for removal instead: work deferred that long has usually been done
	 * some other way, or stopped mattering.
	 */
	taskStalenessMs: number;
	/**
	 * How many bytes of files `splates attach` lets one task hold, all of them
	 * together: a screen recording is the one thing here that grows fast.
	 */
	attachmentCapacity: number;
	/** How many bytes one artifact a conversation keeps may be (`artifacts.ts`). */
	artifactFileCapacity: number;
	/**
	 * How many bytes of artifacts one conversation may keep, every version
	 * whose bytes have not been deleted.
	 */
	artifactConversationCapacity: number;
	/** How many bytes of artifacts every conversation in the project may keep together. */
	artifactProjectCapacity: number;
	/**
	 * The command the `splates server` Budget page runs `scry budgets` with, from
	 * the repo's root. Leave it unset when the repo installs `@webappwiz/cli`;
	 * name a wrapper of the repo's own otherwise, like `"./bin/wiz"`.
	 */
	wiz: string;
	/**
	 * What carries `splates server --tunnel` to its public host, a TunnelProvider
	 * of your own for any tunnel; null runs `cloudflared`.
	 */
	tunnel: TunnelProvider | null;
	/**
	 * What makes worker machines when agents queue for want of a slot, and
	 * for `splates worker add --provider`: a provider of your own; null makes
	 * none. Read, as `tunnel` is, from the
	 * repo `splates server` is started in.
	 */
	workerProvider: WorkerProvider | null;
	/**
	 * The platform the project's agents must run on, for a project that
	 * builds only there: its tasks wait for a worker on it rather than run
	 * elsewhere. Null runs them on any.
	 */
	platform: "linux" | "macos" | "windows" | null;
}

/**
 * What `splates.config.ts` exports as its default, typed by a type-only import
 * so a reader can import the file without splates installed:
 *
 * ```ts
 * import type { ConfigFile } from "@stringsync/splates-server/config";
 *
 * export default { preMerge: "bun test" } satisfies ConfigFile;
 * ```
 */
export type ConfigFile = Partial<Config>;

/**
 * Types a config written before `ConfigFile`, which wraps its default in
 * `defineConfig(...)`, so it still loads until `splates update` rewrites it.
 *
 * @deprecated `satisfies ConfigFile` instead.
 */
export function defineConfig(config: Partial<Config>): Partial<Config> {
	return config;
}

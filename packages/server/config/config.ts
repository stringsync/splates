import type { TaskEventName } from "../hooks";
import type { ReplicaPlace } from "../replica";
import type { TunnelProvider } from "../tunnel";

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
	 * Command run by `merge` after the first rebase, via `sh -c`, before the
	 * merge waits for the premerge lock, so a check that needs neither the lock
	 * nor the cores fails without the wait. A nonzero exit refuses the merge as
	 * a failed gate. `preMerge` then runs with `$SPLATES_CHECKED` set to the
	 * commit this passed on, so it can skip what that run covered.
	 */
	preLock: string | null;
	/**
	 * Command `splates ship` runs from the root, via `sh -c`, to release the
	 * project: publish its public packages at their next version and leave the
	 * release committed and tagged on the trunk, as `"wiz dev ship"`. Null
	 * means the project is never shipped from splates, though it still takes
	 * the bumps of those it depends on.
	 */
	ship: string | null;
	/**
	 * Command that reads live release versions, via `sh -c` in the main tree.
	 * Prints JSON `{version, artifacts: [{name, deployed}]}`; `deployed` is a
	 * version string or null before anything is live. Null reads npm's latest
	 * dist-tag for each public package instead. Failures stop the read.
	 */
	shipStatus: string | null;
	/**
	 * Command a project that pins this one's packages runs once a ship's
	 * cascade has moved its pins to the versions this one shipped, after `bun
	 * install`: its bump task lists it as a step for the agent to run in the
	 * task's worktree and commit what it changed, as `"bunx
	 * @stringsync/splates refresh"`. Null asks nothing past the install.
	 */
	afterBump: string | null;
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
	 * Maximum conflicted rebases before you must allow more with `splates retry`.
	 * Conflicts count separately from failed merge gates (`mergeRetryCount`).
	 */
	mergeConflictCount: number;
	/**
	 * How many removed task names to remember. Increase this to keep `remove`
	 * reporting "already removed" for older tasks.
	 */
	removedCapacity: number;
	/**
	 * How many finished tasks to keep, each with the `SPLATES.md` it ended on,
	 * for the Tasks page's Finished list, which shows every one kept. The
	 * oldest to finish goes first.
	 */
	finishedCapacity: number;
	/**
	 * Maximum events per log file. Increase this to keep more events together
	 * before the log rotates.
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
	 * The platform the project's agents must run on, for a project that
	 * builds only there: its tasks wait for a worker on it rather than run
	 * elsewhere. Null runs them on any.
	 */
	platform: "linux" | "macos" | "windows" | null;
	/**
	 * Where `splates server` keeps a copy of the project's records, a few
	 * seconds behind every change: a bucket of any S3-compatible store, as
	 * `{ provider: "s3", endpoint: "https://<store's endpoint>", bucket: "my-splates" }`,
	 * whose key and secret the Creds page asks for as `REPLICA_ACCESS_KEY` and
	 * `REPLICA_SECRET_KEY`, or a folder, as `{ provider: "dir", path: "/Volumes/Backup/splates" }`.
	 * The copy is where the records move from when the server moves to
	 * another machine. Null keeps none.
	 */
	replica: ReplicaPlace | null;
	/**
	 * Words the composer's mic should spell as written, for everyone who
	 * dictates in the project: its tools, modules and names, as
	 * `["webappwiz", "scry"]`. Splates and the project's name are always
	 * told; each person adds their own on the Setup page.
	 */
	dictationWords: string[];
	/**
	 * Where the project's evals, run by any framework, leave their results for
	 * the Evals page, as `{ results: ".evals" }`: relative to the project's
	 * root, absolute, or under `~`. Each batch is a directory of it holding a
	 * `batch.json` and a `results.jsonl` in the `splates-evals/1` format
	 * (`designs/evals-contract.md`). Null shows no Evals page.
	 */
	evals: EvalsConfig | null;
}

/**
 * Where a project's evals report to splates, and the commands that start
 * them from the page's run card (`docs/evals.md`).
 */
export interface EvalsConfig {
	/** The directory holding one directory per batch. */
	results: string;
	/**
	 * Prints the cases a run card can pick, one JSON object a line, as
	 * `{"case": "refunds/partial", "group": "refunds", "about": "..."}`.
	 */
	list?: string;
	/**
	 * Runs the cases in `SPLATES_EVALS_CASES` on the targets in
	 * `SPLATES_EVALS_TARGETS` into a new batch directory under
	 * `SPLATES_EVALS_RESULTS`. Without it the page only shows results.
	 */
	run?: string;
	/**
	 * Told what `run` is, prints what the run comes to as
	 * `{"cells": 12, "usd": 3.6}`, so the card shows a ceiling; exits non-zero
	 * to refuse the run. Without it the card shows no cost.
	 */
	plan?: string;
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
 * Return your project settings with their types checked.
 *
 * @deprecated Use `satisfies ConfigFile` on your default export instead.
 */
export function defineConfig(config: Partial<Config>): Partial<Config> {
	return config;
}

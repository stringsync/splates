import { color, type Logger } from "webappwiz/log";
import type { BranchMoves } from "./agents";
import type { Config } from "./config";
import { LEGACY_PLAN_FILE } from "./config";
import type { Creds } from "./creds";
import type { Git } from "./git";
import { GitHubApp, githubRepo, type InstallationToken } from "./github-app";
import { PLAN_FILE, type PlanStore } from "./plans";
import type { Worktree } from "./tasks";
import { taskOf } from "./tasks";

/** What a task's branch is pushed as on the central remote: `splates/<task>`. */
export const PUSHED_PREFIX = "splates/";

/** A token this close to expiring is minted again rather than pushed with. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

/** How a push or a delete of a task's branch went. */
export type Pushed =
	/** The remote has the branch as it stands, or has it no more for a delete. */
	| { status: "pushed"; branch: string }
	/** No central remote is configured, so nothing was pushed. */
	| { status: "off" }
	/** Refused before git was asked, for `why`. */
	| { status: "refused"; why: string }
	/** Git or GitHub refused it, saying `why`. */
	| { status: "failed"; why: string };

/** What mints a task's tokens: the GitHub App, or a coordinator that keeps it. */
export type TokenMinter = Pick<GitHubApp, "token">;

/** Where `TaskBranches` finds what it mints tokens with. */
export interface AppSource {
	/** The App, or null when its creds are not kept. */
	app(): Promise<TokenMinter | null>;
}

/** Where `TaskBranches` reads a task's branch, for a push, a delete or a sign-in. */
export interface BranchOptions {
	/** The repository the branch is in: the main tree's by default, or a clone's. */
	at?: Git;
}

/** What `TaskBranches.of` reaches GitHub through; the global `fetch` by default. */
export interface TaskBranchesOptions {
	fetch?: typeof fetch;
}

/** Where a push goes and what it signs in with. */
export interface Target {
	/** A remote's name, or a URL. */
	to: string;
	/** The URL it fetches from, which a clone is made from. */
	url: string;
	/** Added to git's environment, carrying a token when there is one. */
	env: Record<string, string>;
}

/**
 * Each task's branch on the project's central remote, `config.remote`, as
 * `splates/<task>`: pushed after every commit and at every checkpoint, so a
 * task outlives the machine it runs on, and deleted once it merges or is
 * removed. Nothing here ever pushes anything but a `splates/*` branch, and
 * a branch that tracks `SPLATES.md` is never pushed at all.
 *
 * With the GitHub App's creds kept, it pushes with a token the App mints per
 * task, good for an hour and for this repository's contents alone; without
 * them, with this machine's own git credentials.
 */
export class TaskBranches {
	/** By task, the token it pushes with until it nears its expiry. */
	private readonly tokens = new Map<string, InstallationToken>();
	/**
	 * By task, its last push or delete, which the next waits for: two pushes
	 * racing could leave the older last, and the remote behind.
	 */
	private readonly last = new Map<string, Promise<unknown>>();

	constructor(
		private readonly git: Git,
		/** Names the remote, `remote`, read at each push; null pushes nothing. */
		private readonly config: Pick<Config, "remote">,
		private readonly apps: AppSource,
		/** Where a pushed task's plan is kept beside its branch; none keeps no plans. */
		private readonly plans: PlanStore | null = null,
	) {}

	/** The project's, pushing to its configured remote with its kept creds. */
	static of(
		{
			git,
			config,
			creds,
			plans,
		}: { git: Git; config: Config; creds: Creds; plans?: PlanStore },
		opts: TaskBranchesOptions = {},
	): TaskBranches {
		return new TaskBranches(
			git,
			config,
			{ app: () => GitHubApp.kept(creds, opts) },
			plans ?? null,
		);
	}

	/** The remote's name, or null when none is configured. */
	remote(): string | null {
		return this.config.remote;
	}

	/** The branch `task` is pushed as. */
	pushedBranch(task: string): string {
		return `${PUSHED_PREFIX}${task}`;
	}

	/**
	 * Pushes `branch`, the task's own, to the remote as `splates/<task>`,
	 * replacing what is there, since a task's branch is rebased and squashed
	 * as it goes. Run while a rebase is under way, it pushes the branch as it
	 * stood before the rebase.
	 */
	async push(
		task: string,
		branch: string,
		opts: BranchOptions = {},
	): Promise<Pushed> {
		const at = opts.at ?? this.git;
		if (this.config.remote === null) {
			return { status: "off" };
		}
		const name = checkedName(task);
		if (name !== null) {
			return { status: "refused", why: name };
		}
		const plans = await at.tracked(`refs/heads/${branch}`, [
			PLAN_FILE,
			LEGACY_PLAN_FILE,
		]);
		if (plans.length > 0) {
			return {
				status: "refused",
				why: `${branch} tracks ${plans.join(" and ")}, which never leaves this machine: \`git rm --cached ${plans.join(" ")}\` and commit`,
			};
		}
		const pushed = await this.run(
			task,
			[
				"--force",
				"--no-verify",
				"--",
				`refs/heads/${branch}:refs/heads/${this.pushedBranch(task)}`,
			],
			at,
		);
		// Only a push from a task's own checkout carries its plan: the main
		// tree's would be another plan's.
		if (pushed.status === "pushed" && opts.at !== undefined) {
			await this.plans?.save(task, at.root).catch(() => {});
		}
		return pushed;
	}

	/** Writes the plan kept for `tree`'s task into it when it has none: false when nothing was written. */
	restorePlan(tree: Pick<Worktree, "task" | "path">): Promise<boolean> {
		return (
			this.plans?.restore(tree.task, tree.path).catch(() => false) ??
			Promise.resolve(false)
		);
	}

	/** Pushes a task's own branch from its checkout, a worktree or a clone, as `push` does. */
	pushTree(tree: Pick<Worktree, "task" | "branch" | "git">): Promise<Pushed> {
		return this.push(tree.task, tree.branch, { at: tree.git });
	}

	/** Deletes `splates/<task>` from the remote; one already gone is deleted too. */
	async delete(task: string, opts: BranchOptions = {}): Promise<Pushed> {
		const at = opts.at ?? this.git;
		if (this.config.remote === null) {
			return { status: "off" };
		}
		const name = checkedName(task);
		if (name !== null) {
			return { status: "refused", why: name };
		}
		const deleted = await this.run(
			task,
			[
				"--no-verify",
				"--delete",
				"--",
				`refs/heads/${this.pushedBranch(task)}`,
			],
			at,
		);
		this.tokens.delete(task);
		await this.plans?.drop(task).catch(() => {});
		return deleted.status === "failed" &&
			/remote ref does not exist/i.test(deleted.why)
			? { status: "pushed", branch: this.pushedBranch(task) }
			: deleted;
	}

	/**
	 * Fetches the remote's `trunk` into `refs/remotes/<remote>/<trunk>`,
	 * signing in as `task`'s pushes do, and gives the commit it is at: what a
	 * merge rebases onto, since only the coordinator moves trunk there.
	 */
	async fetchTrunk(
		task: string,
		trunk: string,
		cwd: string,
	): Promise<
		| { status: "fetched"; commit: string }
		| Exclude<Pushed, { status: "pushed" }>
	> {
		const remote = this.config.remote;
		if (remote === null) {
			return { status: "off" };
		}
		const name = checkedName(task);
		if (name !== null) {
			return { status: "refused", why: name };
		}
		let target: Target;
		try {
			target = await this.target(task, remote, this.git);
		} catch (error) {
			return { status: "failed", why: String(error) };
		}
		const tracking = trackingRef(remote, trunk);
		const fetched = await this.git.fetch(
			cwd,
			[target.to, `+refs/heads/${trunk}:${tracking}`],
			target.env,
		);
		if (fetched.code !== 0) {
			return { status: "failed", why: fetched.stderr || fetched.stdout };
		}
		return {
			status: "fetched",
			commit: await this.git.out(cwd, "rev-parse", tracking),
		};
	}

	/**
	 * Where `task`'s branch is pushed and fetched, signing in with a token
	 * of its own when the App is kept; null when no remote is configured.
	 * Read in `at`, the repository the task's branch is in. A null `task`
	 * signs in for the project's own checkout, with a token minted afresh.
	 */
	async signIn(
		task: string | null,
		opts: BranchOptions = {},
	): Promise<Target | null> {
		const remote = this.config.remote;
		return remote === null
			? null
			: this.target(task, remote, opts.at ?? this.git);
	}

	/**
	 * A token of the App's for the project's own repository, as the
	 * coordinator mints one for a worker's git; null when the App is not
	 * kept or the remote is not on github.com. Never for any other
	 * repository, whatever the worker asks.
	 */
	async mint(): Promise<InstallationToken | null> {
		const remote = this.config.remote;
		const url = remote === null ? null : await this.git.remoteUrl(remote);
		const repo = url === null ? null : githubRepo(url);
		const app = repo === null ? null : await this.apps.app();
		return repo === null || app === null ? null : app.token(repo);
	}

	private run(task: string, args: string[], at: Git): Promise<Pushed> {
		const ran = (this.last.get(task) ?? Promise.resolve())
			.catch(() => {})
			.then(() => this.runNow(task, args, at));
		this.last.set(task, ran);
		void ran.finally(() => {
			if (this.last.get(task) === ran) {
				this.last.delete(task);
			}
		});
		return ran;
	}

	private async runNow(task: string, args: string[], at: Git): Promise<Pushed> {
		let target: Target;
		const remote = this.config.remote;
		if (remote === null) {
			return { status: "off" };
		}
		try {
			target = await this.target(task, remote, at);
		} catch (error) {
			return { status: "failed", why: String(error) };
		}
		const pushed = await at.push(at.root, [target.to, ...args], target.env);
		return pushed.code === 0
			? { status: "pushed", branch: this.pushedBranch(task) }
			: { status: "failed", why: pushed.stderr || pushed.stdout };
	}

	/**
	 * The App's https URL for the remote, signing in with a token of `task`'s,
	 * when the App is kept and the remote is on github.com; the remote itself
	 * otherwise, signing in as this machine does.
	 */
	private async target(
		task: string | null,
		remote: string,
		at: Git,
	): Promise<Target> {
		const url = await at.remoteUrl(remote);
		const repo = url === null ? null : githubRepo(url);
		const app = repo === null ? null : await this.apps.app();
		if (repo === null || app === null) {
			return { to: remote, url: url ?? remote, env: {} };
		}
		let held = task === null ? undefined : this.tokens.get(task);
		if (
			held === undefined ||
			held.expiresAt.getTime() - Date.now() < TOKEN_MARGIN_MS
		) {
			held = await app.token(repo);
			if (task !== null) {
				this.tokens.set(task, held);
			}
		}
		const basic = Buffer.from(`x-access-token:${held.token}`).toString(
			"base64",
		);
		const https = `https://github.com/${repo.owner}/${repo.name}.git`;
		return {
			to: https,
			url: https,
			env: {
				GIT_CONFIG_COUNT: "2",
				GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
				GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
				// Empty clears the helpers git would ask, so the token is all
				// it signs in with.
				GIT_CONFIG_KEY_1: "credential.helper",
				GIT_CONFIG_VALUE_1: "",
			},
		};
	}
}

/** Where `remote`'s `trunk` is kept once fetched. */
export function trackingRef(remote: string, trunk: string): string {
	return `refs/remotes/${remote}/${trunk}`;
}

/** Why `task` cannot name a pushed branch, or null when it can. */
function checkedName(task: string): string | null {
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(task) && !task.includes("..")
		? null
		: `'${task}' cannot name a branch on the remote`;
}

/**
 * The line a command's report gives a push or a delete, `what` saying which:
 * none when no remote is configured, and what stopped it when it failed.
 */
export function pushedLine(
	pushed: Pushed,
	what: "pushed" | "deleted",
): string | null {
	switch (pushed.status) {
		case "off":
			return null;
		case "pushed":
			return `  remote:   ${what} ${pushed.branch}`;
		default:
			return color.yellow(
				`  remote:   not ${what}, so ${what === "pushed" ? "the remote's copy is behind" : "the remote still has it"}: ${pushed.why}`,
			);
	}
}

/**
 * What `Watch` tells of each command that moved a branch, as `splates server`
 * does for its agents: pushes the branch when it is a task's, so each commit
 * reaches the remote as it is made, and logs a push that fails.
 */
export function pushOnMove(branches: TaskBranches, log: Logger): BranchMoves {
	return {
		moved: (branch, at) => {
			const task = taskOf(branch);
			if (task === null) {
				return;
			}
			// From the tree it moved in, on its worker: a clone's branch is
			// in no other repository.
			void branches.push(task, branch, { at }).then(
				(pushed) => {
					if (pushed.status === "refused" || pushed.status === "failed") {
						log.error(`could not push ${branch}: ${pushed.why}`);
					}
				},
				(error: unknown) => log.error(`could not push ${branch}: ${error}`),
			);
		},
	};
}

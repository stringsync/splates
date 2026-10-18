import { dirname } from "node:path";
import type { Fs } from "webappwiz/system";
import type { Config } from "../config";
import type { Git, GitResult } from "../git";
import { taskOf } from "../tasks";
import { PUSHED_PREFIX, type TaskBranches } from "./branches";
import { type Checkouts, HOME_KEY, MIRROR_KEY } from "./checkouts";

/**
 * Clones from the central remote, borrowing the objects of the bare mirror
 * the worker keeps for the project (`--reference-if-able`), as a remote
 * worker's disposable checkouts. Each clone is signed in to with a token of
 * its task's, in git's environment alone: its config names the remote's
 * plain URL.
 */
export class CloneCheckouts implements Checkouts {
	constructor(
		/** The worker's project clone, the main tree commands run against. */
		private readonly git: Git,
		private readonly config: Pick<Config, "remote">,
		private readonly branches: TaskBranches,
		private readonly fs: Fs,
	) {}

	async add(
		task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult> {
		return this.clone(task, branch, path, base, remoteBranch(base));
	}

	async resume(
		task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult> {
		return this.clone(
			task,
			branch,
			path,
			base,
			this.branches.pushedBranch(task),
		);
	}

	async remove(path: string): Promise<GitResult> {
		await this.fs.rm(path, { recursive: true, force: true });
		return { code: 0, stdout: "", stderr: "" };
	}

	gitOf(path: string): Git {
		return this.git.at(path);
	}

	/**
	 * Clones `from`, a branch on the remote, to `path`, checked out as
	 * `branch`; `base` is made a local branch beside it, tracking its own,
	 * so what the task has that its base does not reads as in a worktree.
	 */
	private async clone(
		task: string,
		branch: string,
		path: string,
		base: string,
		from: string,
	): Promise<GitResult> {
		const remote = this.config.remote;
		const target = await this.branches.signIn(task).catch((error: unknown) => {
			throw new Error(`cannot sign in to the remote: ${String(error)}`);
		});
		if (remote === null || target === null) {
			return refused(
				"a worker clones each task from the central remote: set `remote` in splates.config.ts",
			);
		}
		const mirror = await this.mirror();
		if (mirror !== null) {
			// Fresh objects to borrow, so the clone fetches little; a mirror
			// that will not fetch still lends what it has.
			await this.git.runWith(
				mirror,
				[
					"fetch",
					"--quiet",
					"--prune",
					target.url,
					"+refs/heads/*:refs/heads/*",
				],
				target.env,
			);
		}
		await this.fs.mkdir(dirname(path));
		const cloned = await this.git.runWith(
			dirname(path),
			[
				"clone",
				"--quiet",
				"--origin",
				remote,
				...(mirror === null ? [] : ["--reference-if-able", mirror]),
				"--branch",
				from,
				"--",
				target.url,
				path,
			],
			target.env,
		);
		if (cloned.code !== 0) {
			return cloned;
		}
		const steps: string[][] = [
			["switch", "--quiet", "-c", branch],
			["config", HOME_KEY, this.git.root],
		];
		const baseFrom = remoteBranch(base);
		if (baseFrom !== from) {
			steps.push([
				"branch",
				"--quiet",
				"--track",
				base,
				`${remote}/${baseFrom}`,
			]);
		}
		for (const args of steps) {
			const ran = await this.git.run(path, ...args);
			if (ran.code !== 0) {
				return ran;
			}
		}
		return { code: 0, stdout: "", stderr: "" };
	}

	/** The mirror the project clone names, or null for a clone made without one. */
	private async mirror(): Promise<string | null> {
		const { code, stdout } = await this.git.run(
			this.git.root,
			"config",
			"--get",
			MIRROR_KEY,
		);
		return code === 0 && stdout !== "" ? stdout : null;
	}
}

/** The branch on the remote `base` is: a task's as it is pushed, any other as it is. */
function remoteBranch(base: string): string {
	const task = taskOf(base);
	return task === null ? base : `${PUSHED_PREFIX}${task}`;
}

function refused(why: string): GitResult {
	return { code: 1, stdout: "", stderr: why };
}

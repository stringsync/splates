import type { Fs, Ps } from "core/system";
import type { Git } from "../git";
import type { RunCheckouts } from "./engine";
import { lastLines } from "./shell";

/** How long readying a run's checkout (its `postCheckout`) may take. */
const READY_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Each run's checkout as a detached git worktree at `<root>/.ships/<run>`,
 * beside the task worktrees, readied with the repository's `postCheckout`.
 */
export class GitRunCheckouts implements RunCheckouts {
	constructor(
		private readonly git: Git,
		private readonly ps: Pick<Ps, "spawnCapture">,
		private readonly fs: Pick<Fs, "exists">,
		/** Where task worktrees live; run checkouts go in its `.ships`. */
		private readonly worktreeRoot: string,
		/** Run in a new checkout via `sh -c`, as `splates add` runs it. */
		private readonly postCheckout: string | null,
	) {}

	head(): Promise<string> {
		return this.git
			.out(this.git.root, "rev-parse", "HEAD")
			.then((out) => out.trim());
	}

	path(run: string): string {
		return `${this.worktreeRoot}/.ships/${run}`;
	}

	async ready(run: string, commit: string): Promise<string> {
		const path = this.path(run);
		if (await this.fs.exists(path)) {
			return path;
		}
		// A checkout whose directory went leaves git's record of it behind.
		await this.git.pruneWorktrees();
		const added = await this.git.run(
			this.git.root,
			"worktree",
			"add",
			"--detach",
			path,
			commit,
		);
		if (added.code !== 0) {
			throw new Error(lastLines(added.stderr || added.stdout));
		}
		if (this.postCheckout) {
			const ran = await this.ps.spawnCapture(["sh", "-c", this.postCheckout], {
				cwd: path,
				stdin: "",
				timeoutMs: READY_TIMEOUT_MS,
			});
			if (ran.exitCode !== 0) {
				await this.git.removeWorktree(path);
				throw new Error(
					`"${this.postCheckout}" exited ${ran.exitCode}: ${lastLines(ran.stderr || ran.stdout)}`,
				);
			}
		}
		return path;
	}

	async apply(run: string, commit: string, landed: string): Promise<string> {
		const path = await this.ready(run, commit);
		const picked = await this.git.cherryPick(path, landed);
		if (picked.code !== 0) {
			await this.git.run(path, "cherry-pick", "--abort");
			throw new Error(lastLines(picked.stderr || picked.stdout));
		}
		return (await this.git.out(path, "rev-parse", "HEAD")).trim();
	}

	async release(run: string): Promise<void> {
		const path = this.path(run);
		if (!(await this.fs.exists(path))) {
			return;
		}
		const removed = await this.git.removeWorktree(path);
		if (removed.code !== 0) {
			throw new Error(removed.stderr || removed.stdout);
		}
	}
}

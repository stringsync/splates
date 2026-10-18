import type { Fs } from "webappwiz/system";
import type { Checkouts } from "./checkouts";
import type { Git, GitResult } from "./git";

/** Linked worktrees of the main tree, as the local worker keeps. */
export class WorktreeCheckouts implements Checkouts {
	constructor(
		private readonly git: Git,
		private readonly fs: Fs,
	) {}

	add(
		_task: string,
		branch: string,
		path: string,
		base: string,
	): Promise<GitResult> {
		return this.git.addWorktree(branch, path, base);
	}

	async resume(task: string): Promise<GitResult> {
		return {
			code: 1,
			stdout: "",
			stderr: `a worktree is never made again from the remote: '${task}' has no tree here`,
		};
	}

	async remove(path: string, branch: string): Promise<GitResult> {
		const removed = (await this.fs.exists(path))
			? await this.git.removeWorktree(path)
			: // Directory gone by other means: drop the metadata git still holds.
				await this.git.pruneWorktrees();
		if (removed.code !== 0 || !(await this.git.branchExists(branch))) {
			return removed;
		}
		return this.git.deleteBranch(branch);
	}

	gitOf(): Git {
		return this.git;
	}
}

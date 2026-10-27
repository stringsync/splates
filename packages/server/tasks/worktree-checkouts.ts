import type { Fs } from "webappwiz/system";
import type { Git, GitResult } from "../git";

/** Linked worktrees of the main tree, as the local worker keeps. */
export class WorktreeCheckouts {
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

	async remove(path: string, branch: string): Promise<GitResult> {
		const exists = await this.fs.exists(path);
		let removed = exists
			? await this.git.removeWorktree(path)
			: // Directory gone by other means: drop the metadata git still holds.
				await this.git.pruneWorktrees();
		if (
			exists &&
			removed.code !== 0 &&
			removed.stderr.includes(`'${path}' is not a working tree`)
		) {
			for (let attempt = 0; ; attempt++) {
				try {
					await this.fs.rm(path, { recursive: true, force: true });
					break;
				} catch (error) {
					if (
						(error as { code?: string }).code !== "ENOTEMPTY" ||
						attempt === 5
					) {
						throw error;
					}
					await Bun.sleep(100);
				}
			}
			removed = await this.git.pruneWorktrees();
		}
		if (removed.code !== 0 || !(await this.git.branchExists(branch))) {
			return removed;
		}
		return this.git.deleteBranch(branch);
	}
}

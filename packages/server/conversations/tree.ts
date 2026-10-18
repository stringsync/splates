import { fail } from "../exit";
import type { WorktreeService } from "../tasks";

/**
 * Where a conversation runs: its task's name, the tree, the branch the task
 * was cut from, and the conversation whose agent added it.
 */
export type Tree = [string | null, string, string | null, string | null];

/**
 * Where a conversation for `task` runs: its worktree, or the main tree for
 * none, refusing a task whose worktree is gone.
 */
export async function treeOf(
	service: WorktreeService,
	task: unknown,
): Promise<Tree> {
	const named = typeof task === "string" && task !== "" ? task : null;
	const worktree = named === null ? null : await service.find(named);
	if (worktree !== null && !worktree.exists) {
		fail("not_found", `no worktree for '${named}'`, { task: named });
	}
	return [
		named,
		worktree?.path ?? service.git.root,
		worktree?.base ?? null,
		worktree?.caller ?? null,
	];
}

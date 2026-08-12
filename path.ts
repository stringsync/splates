import type { Logger } from "@webappwiz/log";
import { fail } from "./exit";
import type { WorktreeStore } from "./worktree-store";

/**
 * Where a task lives, or (with no task) the main tree. Nothing but the path
 * on stdout, so it composes: `cd "$(arbor path)"`, `zed -a "$(arbor path x)"`.
 * Moving between trees is `cd` and nothing else, and the main tree is the one
 * path a process standing in a worktree cannot otherwise name: git's
 * `--show-toplevel` hands back the worktree it is already in.
 */
export async function path(
	{ store, log }: { store: WorktreeStore; log: Logger },
	task?: string,
): Promise<void> {
	if (!task) {
		log.info(store.git.root);
		return;
	}

	const worktree = await store.find(task);
	if (worktree.gone) {
		fail(
			"not_found",
			`no task '${task}': run \`arbor ls\` to see what there is`,
			{ task },
		);
	}
	// A path you cannot cd into is worse than no answer: say so on stderr and
	// leave stdout empty rather than handing back a directory that is not there.
	if (!worktree.exists) {
		fail("orphaned", `'${task}' has no worktree at ${worktree.path}`, {
			task,
			worktree: worktree.path,
		});
	}
	log.info(worktree.path);
}

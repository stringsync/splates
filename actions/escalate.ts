import { color, type Logger } from "@webappwiz/log";
import type { Lock } from "@webappwiz/sys";
import { fail } from "../lib/exit";
import type { Git } from "../lib/git";
import type { WorktreeStore } from "../lib/worktree-store";

/**
 * The way out that is not "resolve the conflict badly to finish the task".
 * When both sides restructured the same logic there is no correct merge, only
 * a decision — and that belongs to a human.
 */
export async function escalate(
	{
		store,
		git,
		lock,
		log,
	}: {
		store: WorktreeStore;
		git: Git;
		lock: Lock;
		log: Logger;
	},
	reason: string,
	cwd: string,
	task?: string,
): Promise<void> {
	const branch = await git.currentBranch(cwd).catch(() => "");
	const name = task || store.taskFor(branch);
	if (!name) {
		fail(
			"usage",
			"not in a task worktree — pass --task <name> to escalate from elsewhere",
		);
	}
	const found = await store.find(name);
	if (!found.state) {
		fail("not_found", `no state file for '${name}'`, { task: name });
	}

	const escalations = [
		...(found.state.escalations ?? []),
		{ reason, at: new Date().toISOString() },
	];
	// The worktree is left exactly as it is: a human needs to see what the
	// agent saw, conflict markers and all.
	const worktree = await found.save({
		status: "escalated",
		lease: null,
		escalations,
	});
	await lock.releaseIfOurs();

	log.info(
		[
			`${color.yellow("escalated")} ${worktree.task}`,
			`  worktree: ${worktree.path}`,
			`  branch:   ${worktree.branch}`,
			`  reason:   ${reason}`,
			escalations.length > 1
				? `  (${escalations.length} escalations recorded)`
				: "",
			"",
			"Left untouched for a human. Stop working on this task.",
		]
			.filter(Boolean)
			.join("\n"),
	);
}

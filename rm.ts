import { color, type Logger } from "webappwiz/log";
import { fail } from "./exit";
import type { WorktreeService } from "./worktree-service";

export interface RmOptions {
	/** Discard the tree even when another agent holds its lease. */
	force?: boolean;
}

/**
 * Discards a whole task: `git worktree remove` plus the branch and the
 * record.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 */
export async function rm(
	{ service, log }: { service: WorktreeService; log: Logger },
	task: string,
	{ force = false }: RmOptions = {},
): Promise<void> {
	const worktree = await service.find(task);

	if (worktree.gone) {
		const removed = worktree.status === "removed";
		fail(
			removed ? "already_removed" : "not_found",
			removed
				? `'${task}' was already removed (${worktree.removedAt}), nothing left to remove`
				: `no worktree, branch or state file named '${task}', so it never existed here`,
			{ task },
		);
	}

	if (worktree.leaseHeldByOther) {
		if (!force) {
			fail(
				"lease_held",
				`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: pass --force to discard it anyway`,
				{ task, lease: worktree.lease },
			);
		}
		log.error(
			color.yellow(
				`arbor: --force discarding a tree held by pid ${worktree.lease?.pid}`,
			),
		);
	}

	// Counted before the branch goes, so the report can say what was lost.
	const unlanded = worktree.hasBranch ? await worktree.commitsAhead() : 0;

	const discarded = await worktree.discard();
	if (discarded.code !== 0) {
		fail("usage", `discarding '${task}' failed: ${discarded.stderr}`, {
			task,
		});
	}

	const lines = [
		`${color.green("removed")} ${task}`,
		`  worktree: ${worktree.exists ? worktree.path : "already gone"}`,
		`  branch:   ${worktree.hasBranch ? worktree.branch : "already gone"}`,
		`  state:    ${worktree.state ? "removed" : "already gone"}`,
	];
	if (unlanded) {
		lines.push(
			color.yellow(
				`  discarded ${unlanded} commit(s) that were never on ${worktree.base}`,
			),
		);
	}
	log.info(lines.join("\n"));
}

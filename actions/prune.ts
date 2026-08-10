import { color, type Logger } from "@webappwiz/log";
import type { Config } from "../lib/config";
import { fail } from "../lib/exit";
import type { WorktreeStore } from "../lib/worktree-store";

/**
 * Discards a whole workstream — worktree, branch and record. Unrelated to
 * `git worktree prune`, which only tidies stale metadata.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 */
export async function prune(
	{ store, config, log }: { store: WorktreeStore; config: Config; log: Logger },
	task: string,
	{ force = false }: { force?: boolean } = {},
): Promise<void> {
	const worktree = await store.find(task);

	if (worktree.gone) {
		const pruned = worktree.status === "pruned";
		fail(
			pruned ? "already_pruned" : "not_found",
			pruned
				? `'${task}' was already pruned (${worktree.prunedAt}) — nothing left to remove`
				: `no worktree, branch or state file named '${task}' — it never existed here`,
			{ task },
		);
	}

	if (worktree.leaseHeld) {
		if (!force) {
			fail(
				"lease_live",
				`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname} — pass --force to discard it anyway`,
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
		`${color.green("pruned")} ${task}`,
		`  worktree: ${worktree.exists ? worktree.path : "already gone"}`,
		`  branch:   ${worktree.hasBranch ? worktree.branch : "already gone"}`,
		`  state:    ${worktree.state ? "removed" : "already gone"}`,
	];
	if (unlanded) {
		lines.push(
			color.yellow(
				`  discarded ${unlanded} commit(s) that were never on ${config.trunk}`,
			),
		);
	}
	log.info(lines.join("\n"));
}

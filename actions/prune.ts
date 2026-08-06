import { color } from "@webappwiz/log";
import type { Arbor } from "../lib/arbor";

/**
 * Discards a whole workstream — worktree, branch and record. Unrelated to
 * `git worktree prune`, which only tidies stale metadata.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 */
export async function prune(
	arbor: Arbor,
	task: string,
	{ force = false }: { force?: boolean } = {},
): Promise<void> {
	const worktree = await arbor.store.find(task);

	if (worktree.gone) {
		const pruned = worktree.status === "pruned";
		arbor.fail(
			pruned ? "already_pruned" : "not_found",
			pruned
				? `'${task}' was already pruned (${worktree.prunedAt}) — nothing left to remove`
				: `no worktree, branch or state file named '${task}' — it never existed here`,
			{ task },
		);
	}

	if (worktree.leaseHeld) {
		if (!force) {
			arbor.fail(
				"lease_live",
				`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname} — pass --force to discard it anyway`,
				{ task, lease: worktree.lease },
			);
		}
		arbor.log.error(
			color.yellow(
				`arbor: --force discarding a tree held by pid ${worktree.lease?.pid}`,
			),
		);
	}

	// Counted before the branch goes, so the report can say what was lost.
	const unlanded = worktree.hasBranch ? await worktree.commitsAhead() : 0;

	const discarded = await worktree.discard();
	if (discarded.code !== 0) {
		arbor.fail("usage", `discarding '${task}' failed: ${discarded.stderr}`, {
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
				`  discarded ${unlanded} commit(s) that were never on ${arbor.config.trunk}`,
			),
		);
	}
	arbor.log.info(lines.join("\n"));
}

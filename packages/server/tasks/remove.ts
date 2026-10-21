import { color, type Logger } from "webappwiz/log";
import type { Tasks } from "../board";
import { fail } from "../exit";
import { pushedLine, type TaskBranches } from "../merge";
import { freedLine, type Slots } from "../ports";
import type { RemoveReason } from "./worktree";
import type { WorktreeService } from "./worktree-service";

export interface RemoveOptions {
	/** Discard the tree even when another agent holds its lease. */
	force?: boolean;
	/** The `splates server` conversation working on it, when removed from the page. */
	conversation?: string;
	/** Why, kept in its outcome for the Stats page. */
	reason?: RemoveReason;
}

/**
 * Discards a whole task: `git worktree remove` plus the branch and the
 * record.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 *
 * What it took goes back to ready, or the backlog, never the queue, and a
 * queued lane leaves it out until the person queues it again: queued, the
 * runner would start it again at once, and an agent that removes each start
 * of it, finding it done or moot, would work it forever.
 */
export async function remove(
	{
		service,
		log,
		tasks: queue,
		slots,
		branches,
	}: {
		service: WorktreeService;
		log: Logger;
		tasks: Tasks;
		slots: Slots;
		branches: TaskBranches;
	},
	task: string,
	{ force = false, conversation, reason }: RemoveOptions = {},
): Promise<{ released: { id: number; subject: string }[] }> {
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
				`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: another agent is driving this tree. Leave it to that agent, or ask the user, who can pass --force to discard it anyway`,
				{ task, lease: worktree.lease },
			);
		}
		log.error(
			color.yellow(
				`splates: --force discarding a tree held by pid ${worktree.lease?.pid}`,
			),
		);
	}

	// Counted before the branch goes, so the report can say what was lost.
	const unlanded = worktree.hasBranch ? await worktree.commitsAhead() : 0;

	const discarded = await worktree.discard("removed", {
		conversation,
		reason,
		unqueue: true,
	});
	if (discarded.code !== 0) {
		fail("usage", `discarding '${task}' failed: ${discarded.stderr}`, {
			task,
		});
	}

	const freed = await slots.release(worktree.path);
	const deleted = pushedLine(await branches.delete(task), "deleted");

	// The work was thrown away, not done, so what it took up is open again.
	const released = await queue.takenBy(task);
	for (const each of released) {
		await each.release({ unqueue: true });
	}
	await queue.skipInLanes(
		released.map(({ id }) => id),
		true,
	);

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
	if (freed !== null) {
		lines.push(`  slot:     ${freedLine(freed)}`);
	}
	if (deleted !== null) {
		lines.push(deleted);
	}
	for (const each of released) {
		lines.push(
			`  task ${each.id} is open again, out of the queue until queued by hand: ${each.subject}`,
		);
	}
	log.info(lines.join("\n"));
	return {
		released: released.map(({ id, subject }) => ({ id, subject })),
	};
}

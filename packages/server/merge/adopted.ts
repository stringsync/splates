import { fail } from "../exit";
import type { Git } from "../git";
import type { TaskState, Worktree, WorktreeService } from "../tasks";
import type { TaskBranches } from "./branches";
import type { MergeAsk } from "./served";

/** A worker's pushed branch checked out here to be merged, and the record it replaced. */
export interface Adopted {
	worktree: Worktree;
	/** The task's record before the checkout, which `release` puts back. */
	before: TaskState | null;
}

/**
 * Checks out `splates/<task>` as the worker pushed it, at the head the ask
 * names, in a task of the server's own, with the merge budget the worker
 * had spent. The merge runs there as it would in the worker's tree; the
 * worker's tree is never reached.
 */
export async function adopt(
	{
		service,
		git,
		branches,
	}: { service: WorktreeService; git: Git; branches: TaskBranches },
	ask: MergeAsk & { remote: NonNullable<MergeAsk["remote"]> },
): Promise<Adopted> {
	const { task } = ask;
	const existing = await service.find(task);
	if (!existing.gone) {
		// A checkout a restart cut off has a lease no process holds.
		if (existing.state === null || existing.leaseHeldByOther === false) {
			await service.release(existing, existing.state);
		} else {
			fail(
				"blocked",
				`'${task}' is already a task on the server's machine: a remote merge needs a name of its own`,
				{ task },
			);
		}
	}
	const before = existing.state;
	const target = await branches.signIn(task);
	if (target === null) {
		fail("usage", "no central remote is configured to fetch the branch from", {
			task,
		});
	}
	const tracking = `refs/splates/adopted/${task}`;
	const fetched = await git.fetch(
		git.root,
		[target.to, `+refs/heads/${branches.pushedBranch(task)}:${tracking}`],
		target.env,
	);
	if (fetched.code !== 0) {
		fail(
			"blocked",
			`could not fetch ${branches.pushedBranch(task)}: ${fetched.stderr || fetched.stdout}\nNo merge attempt was spent: merge again.`,
			{ task },
		);
	}
	const pushed = await git.out(git.root, "rev-parse", tracking);
	if (pushed !== ask.remote.head) {
		fail(
			"blocked",
			`${branches.pushedBranch(task)} on the remote is ${pushed.slice(0, 8)}, not the ${ask.remote.head.slice(0, 8)} this merge was asked for: merge again. No merge attempt was spent.`,
			{ task },
		);
	}
	const added = await service.add(task);
	if (added.code !== 0) {
		fail(
			"blocked",
			`could not check ${task} out on the server: ${added.stderr || added.stdout}`,
			{ task },
		);
	}
	const made = await service.find(task);
	const reset = await git.run(made.path, "reset", "--hard", pushed);
	if (reset.code !== 0) {
		await service.release(made, before);
		fail(
			"blocked",
			`could not check ${pushed.slice(0, 8)} out: ${reset.stderr || reset.stdout}`,
			{ task },
		);
	}
	const worktree = await made.take({
		mergeAttempts: ask.remote.attempts,
		conflictAttempts: ask.remote.conflicts,
	});
	return { worktree, before };
}

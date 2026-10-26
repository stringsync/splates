import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import type { Config } from "../config";
import { LEGACY_PLAN_FILE } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import { PLAN_FILE, Plans, ready, unfinished, whatIsLeft } from "../plans";
import type { Worktree } from "../tasks";

/**
 * Refuses a merge before it spends anything: a dirty tree, a branch
 * tracking the plan, an exhausted budget, a lease held elsewhere, or
 * unchecked questions and steps.
 */
export async function refuseUnready(
	{ git, fs, config }: { git: Git; fs: Fs; config: Config; log: Logger },
	worktree: Worktree,
): Promise<void> {
	const { task, base } = worktree;
	const dirty = await worktree.uncommitted();
	if (dirty.length > 0) {
		fail(
			"dirty",
			`'${task}' has uncommitted changes: commit them before merging`,
			{ task, paths: dirty },
		);
	}
	// The plan is the task's own, kept beside the code and never in it: a
	// branch that tracks it would land it on the base for every task to share.
	const plans = await git.tracked(`refs/heads/${worktree.branch}`, [
		PLAN_FILE,
		LEGACY_PLAN_FILE,
	]);
	if (plans.length > 0) {
		fail(
			"blocked",
			`'${task}' tracks ${plans.join(" and ")}, which must never land on ${base}: \`git rm --cached ${plans.join(" ")}\`, commit, and merge again. No merge attempt was spent.`,
			{ task, paths: plans },
		);
	}
	if (worktree.budgetSpent) {
		// Once per budget: an agent that keeps trying is one refusal, not many.
		if (worktree.state?.gateFailures?.at(-1)?.reason !== "budget_exhausted") {
			await worktree.save({
				gateFailures: [
					...(worktree.state?.gateFailures ?? []),
					{ reason: "budget_exhausted", at: new Date().toISOString() },
				],
			});
		}
		const spent =
			worktree.mergeAttempts >= config.mergeRetryCount
				? `its ${config.mergeRetryCount} merge attempts`
				: `its ${config.mergeConflictCount} conflicted rebases`;
		fail(
			"budget_exhausted",
			`'${task}' has used ${spent}: ask the user for more with a run-command card naming \`splates retry ${task}\`, which only the user runs, from its Grant, and end your turn; or \`splates remove ${task}\` and start over against current ${base}`,
			{
				task,
				mergeAttempts: worktree.mergeAttempts,
				conflictAttempts: worktree.conflictAttempts,
			},
		);
	}
	if (worktree.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname}: another agent is driving this tree`,
			{ task, lease: worktree.lease },
		);
	}
	// An unchecked question is one the user has yet to answer, or an answer
	// the agent has yet to act on; an unchecked step is work not yet done.
	const left = unfinished((await new Plans(fs).read(worktree.path)) ?? "");
	if (!ready(left)) {
		fail(
			"blocked",
			`'${task}' is not ready to merge: ${whatIsLeft(left)}. Act on each answer and check it off, or ask the user and end your turn; finish each step and check it off, or \`splates task add\` it and drop it; then merge again`,
			{ task, blocked: left.questions, steps: left.steps },
		);
	}
}

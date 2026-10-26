import type { Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import type { Config } from "../config";
import { LEGACY_PLAN_FILE } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import { Notes } from "../notes";
import { PLAN_FILE, Plans, ready, unfinished, whatIsLeft } from "../plans";
import type { Worktree } from "../tasks";

/**
 * Refuses a merge before it spends anything: a dirty tree, a branch
 * tracking the plan, an exhausted budget, a lease held elsewhere, or
 * unchecked questions and steps. Prints the project's notes first on every
 * attempt, refused or not, since merge cannot check that a note still
 * holds and the agent checks its diff against them.
 */
export async function refuseUnready(
	{ git, fs, config, log }: { git: Git; fs: Fs; config: Config; log: Logger },
	worktree: Worktree,
): Promise<void> {
	const { task, base } = worktree;
	const notes = await new Notes(fs)
		.list(worktree.path, config)
		.catch((error: unknown) => {
			log.error(
				`project notes not read: ${error instanceof Error ? error.message : String(error)}`,
			);
			return [];
		});
	if (notes.length > 0) {
		log.info(notes.map((note) => note.description).join("\n"));
	}
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
	if (worktree.mergeAttempts >= config.mergeRetryCount) {
		// Once per budget: an agent that keeps trying is one refusal, not many.
		if (worktree.state?.gateFailures?.at(-1)?.reason !== "budget_exhausted") {
			await worktree.save({
				gateFailures: [
					...(worktree.state?.gateFailures ?? []),
					{ reason: "budget_exhausted", at: new Date().toISOString() },
				],
			});
		}
		fail(
			"budget_exhausted",
			`'${task}' has used its ${config.mergeRetryCount} merge attempts: ask the user for another ${config.mergeRetryCount} with a run-command card naming \`splates retry ${task}\`, which only the user runs, from its Grant, and end your turn; or \`splates remove ${task}\` and start over against current ${base}`,
			{ task, mergeAttempts: worktree.mergeAttempts },
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

import { color, type Logger } from "@webappwiz/log";
import type { Lock } from "@webappwiz/sys";
import type { Config } from "./config";
import { fail } from "./exit";
import type { Git } from "./git";
import type { Shell } from "./shell";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

const TAIL_LINES = 40;

/**
 * Lands the current worktree's branch on its base branch, trunk unless the
 * task was created with `--base`. Never a merge commit: it rebases onto the
 * base, runs the gate there, and fast-forwards the base with
 * `git merge --ff-only`. History stays linear.
 */
export async function merge(
	{
		service,
		git,
		lock,
		shell,
		config,
		log,
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		shell: Shell;
		config: Config;
		log: Logger;
	},
	cwd: string,
): Promise<void> {
	const branch = await git.currentBranch(cwd).catch(() => "");
	const task = service.taskFor(branch);
	if (!task) {
		fail(
			"not_found",
			`not in a task worktree (branch '${branch}'): run merge from a worktree made by \`arbor add\``,
			{ branch },
		);
	}
	let worktree = await service.find(task);
	if (!worktree.state) {
		fail(
			"not_found",
			`no state file for '${task}': run \`arbor claim ${task}\` first`,
			{ task },
		);
	}

	const base = worktree.base;
	const dirty = await worktree.uncommitted();
	if (dirty.length > 0) {
		fail(
			"dirty",
			`'${task}' has uncommitted changes: commit them before merging`,
			{ task, paths: dirty },
		);
	}
	if (worktree.mergeAttempts >= config.mergeRetryCount) {
		fail(
			"budget_exhausted",
			`'${task}' has used its ${config.mergeRetryCount} merge attempts: run \`arbor escalate <reason>\`, and a human can grant another ${config.mergeRetryCount} with \`arbor retry ${task}\`; or \`arbor rm ${task}\` and start over against current ${base}`,
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
	worktree = await worktree.take();

	// Blocks until free: an agent told "busy, try later" goes and edits code in
	// a branch that is supposed to be frozen.
	await lock.acquire();
	worktree = await worktree.take({ status: "merging" });

	const before = await git.head(worktree.path);
	const rebase = await git.rebase(worktree.path, base);
	if (rebase.code !== 0) {
		// Left in progress on purpose: the agent needs the conflict markers.
		const paths = await git.conflictedPaths(worktree.path);
		await lock.release();
		await bump(worktree);
		fail(
			"conflict",
			[
				`rebase onto ${base} conflicted in ${paths.length || "?"} file(s):`,
				...paths.map((file) => `  ${file}`),
				"",
				"The rebase is still in progress. Resolve the conflicts, `git add` them,",
				"`git rebase --continue`, then run `arbor merge` again.",
				"If both sides restructured the same logic, prefer `arbor escalate <reason>`",
				`or \`arbor rm ${task}\` and redo the task against current ${base}.`,
			].join("\n"),
			{ task, paths },
		);
	}

	// After the rebase, never before: a branch that passed against an older
	// trunk tells you nothing about the combination. This is the only thing
	// standing between semantic conflicts and a broken trunk, and a repo that
	// configures neither hook has chosen to go without it.
	//
	// The two hooks share one shell rather than getting a run each: the recovery
	// is the same either way, and one gate reports one failure however far down
	// it got.
	const gate = [config.postRewrite, config.preMerge]
		.filter(Boolean)
		.join(" && ");
	const gated = gate
		? await shell.run(gate, {
				cwd: worktree.path,
				env: {
					ARBOR_TASK: task,
					ARBOR_WORKTREE: worktree.path,
				},
			})
		: { exitCode: 0, stdout: "", stderr: "" };
	if (gated.exitCode !== 0) {
		// The rebase already finished, so there is nothing for `rebase --abort`
		// to undo: resetting to the pre-rebase commit is what returns the branch
		// to its previous state.
		await git.resetHard(worktree.path, before);
		await lock.release();
		await bump(worktree);
		fail(
			"tests_failed",
			[
				`\`${gate}\` failed after rebasing onto ${base} (exit ${gated.exitCode}).`,
				`${base} is untouched and ${branch} is back at ${before.slice(0, 8)}.`,
				"",
				tail(`${gated.stdout}\n${gated.stderr}`),
			].join("\n"),
			{ task, exitCode: gated.exitCode },
		);
	}

	// Deliberately re-read from disk rather than trusting the copy in hand: a
	// long test run can outlive the lease, and landing after someone else
	// claimed the tree would land work that is no longer ours.
	const current = await worktree.reload();
	if (!current.leaseOurs) {
		await lock.release();
		fail(
			"lease_lost",
			`the lease on '${task}' was taken by pid ${current.lease?.pid} during the merge, stopping without landing. Do not retry; another agent owns this tree.`,
			{ task, lease: current.lease },
		);
	}

	const checkout = await git.checkout(base);
	const merged = checkout.code === 0 ? await git.mergeFfOnly(branch) : checkout;
	if (merged.code !== 0) {
		await lock.release();
		await bump(worktree);
		fail(
			"merge_failed",
			`could not fast-forward ${base} in ${git.root}: ${merged.stderr || merged.stdout}`,
			{ task },
		);
	}

	const head = await git.shortHead(git.root);
	// The work is on trunk, so the tree has nothing left to hold. Discarding it
	// here is what keeps `arbor ls` a list of live work rather than a graveyard
	// of landed tasks.
	//
	// Step out of it first: merge usually runs from inside the tree it is about
	// to delete, and spawning git from a directory that no longer exists fails
	// with ENOENT before git is even reached.
	service.ps.cd(git.root);
	const discarded = await current.discard();
	await lock.release();
	if (discarded.code !== 0) {
		fail(
			"usage",
			`landed '${task}' on ${base} (${head}) but could not discard its worktree: ${discarded.stderr || discarded.stdout}\nRun \`arbor rm ${task}\` to clean up.`,
			{ task },
		);
	}
	log.info(
		`${color.green("merged")} ${task} onto ${base} (${head})\n  worktree removed, cd ${git.root}`,
	);
}

async function bump(worktree: Worktree): Promise<void> {
	await worktree.take({
		status: "working",
		mergeAttempts: worktree.mergeAttempts + 1,
	});
}

function tail(output: string): string {
	return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

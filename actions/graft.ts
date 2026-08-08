import { color, type Logger } from "@webappwiz/log";
import type { Lock } from "@webappwiz/sys";
import type { Config } from "../lib/config";
import type { Failures } from "../lib/failures";
import type { Git } from "../lib/git";
import type { Shell } from "../lib/shell";
import type { Worktree } from "../lib/worktree";
import type { WorktreeStore } from "../lib/worktree-store";

const TAIL_LINES = 40;

/**
 * Lands the current worktree's branch on trunk. Despite the name this never
 * runs `git merge` in the merge-commit sense: it rebases onto trunk, runs the
 * tests there, and fast-forwards trunk. History stays linear.
 */
export async function graft(
	{
		store,
		git,
		lock,
		shell,
		config,
		log,
	}: {
		store: WorktreeStore;
		git: Git;
		lock: Lock;
		shell: Shell;
		config: Config;
		log: Logger;
	},
	failures: Failures,
	cwd: string,
): Promise<void> {
	const branch = await git.currentBranch(cwd).catch(() => "");
	const task = store.taskFor(branch);
	if (!task) {
		failures.fail(
			"not_found",
			`not in a task worktree (branch '${branch}') — run graft from a worktree made by \`arbor create\``,
			{ branch },
		);
	}
	let worktree = await store.find(task);
	if (!worktree.state) {
		failures.fail(
			"not_found",
			`no state file for '${task}' — run \`arbor claim ${task}\` first`,
			{ task },
		);
	}

	const dirty = await worktree.uncommitted();
	if (dirty.length > 0) {
		failures.fail(
			"dirty",
			`'${task}' has uncommitted changes — commit them before grafting`,
			{ task, paths: dirty },
		);
	}
	if (worktree.graftAttempts >= config.graftRetryCount) {
		failures.fail(
			"budget_exhausted",
			`'${task}' has used its ${config.graftRetryCount} graft attempts — run \`arbor escalate <reason>\` or \`arbor prune ${task}\` and start over against current ${config.trunk}`,
			{ task, graftAttempts: worktree.graftAttempts },
		);
	}
	if (worktree.leaseHeld) {
		failures.fail(
			"lease_live",
			`'${task}' is held by pid ${worktree.lease?.pid} on ${worktree.lease?.hostname} — another agent is driving this tree`,
			{ task, lease: worktree.lease },
		);
	}
	worktree = await worktree.take();

	// Blocks until free: an agent told "busy, try later" goes and edits code in
	// a branch that is supposed to be frozen.
	await lock.acquire();
	worktree = await worktree.take({ status: "grafting" });

	const before = await git.head(worktree.path);
	const rebase = await git.rebase(worktree.path, config.trunk);
	if (rebase.code !== 0) {
		// Left in progress on purpose: the agent needs the conflict markers.
		const paths = await git.conflictedPaths(worktree.path);
		await lock.release();
		await bump(worktree);
		failures.fail(
			"conflict",
			[
				`rebase onto ${config.trunk} conflicted in ${paths.length || "?"} file(s):`,
				...paths.map((p) => `  ${p}`),
				"",
				"The rebase is still in progress. Resolve the conflicts, `git add` them,",
				"`git rebase --continue`, then run `arbor graft` again.",
				"If both sides restructured the same logic, prefer `arbor escalate <reason>`",
				`or \`arbor prune ${task}\` and redo the task against current ${config.trunk}.`,
			].join("\n"),
			{ task, paths },
		);
	}

	// After the rebase, never before: a branch that passed against an older
	// trunk tells you nothing about the combination. This is the only thing
	// standing between semantic conflicts and a broken trunk.
	const tests = await shell.run(config.testCommand, {
		cwd: worktree.path,
		env: {
			ARBOR_TASK: task,
			ARBOR_WORKTREE: worktree.path,
		},
	});
	if (tests.exitCode !== 0) {
		// The rebase already finished, so there is nothing for `rebase --abort`
		// to undo — resetting to the pre-rebase commit is what returns the branch
		// to its previous state.
		await git.resetHard(worktree.path, before);
		await lock.release();
		await bump(worktree);
		failures.fail(
			"tests_failed",
			[
				`\`${config.testCommand}\` failed after rebasing onto ${config.trunk} (exit ${tests.exitCode}).`,
				`${config.trunk} is untouched and ${branch} is back at ${before.slice(0, 8)}.`,
				"",
				tail(`${tests.stdout}\n${tests.stderr}`),
			].join("\n"),
			{ task, exitCode: tests.exitCode },
		);
	}

	// Deliberately re-read from disk rather than trusting the copy in hand: a
	// long test run can outlive the lease, and landing after someone else
	// claimed the tree would land work that is no longer ours.
	const current = await worktree.reload();
	if (!current.leaseOurs) {
		await lock.release();
		failures.fail(
			"lease_lost",
			`the lease on '${task}' was taken by pid ${current.lease?.pid} during the graft — stopping without landing. Do not retry; another agent owns this tree.`,
			{ task, lease: current.lease },
		);
	}

	const checkout = await git.checkout(config.trunk);
	const merged = checkout.code === 0 ? await git.mergeFfOnly(branch) : checkout;
	if (merged.code !== 0) {
		await lock.release();
		await bump(worktree);
		failures.fail(
			"merge_failed",
			`could not fast-forward ${config.trunk} in ${git.root}: ${merged.stderr || merged.stdout}`,
			{ task },
		);
	}

	const head = await git.shortHead(git.root);
	await worktree.take({ status: "working", graftAttempts: 0 });
	await lock.release();
	log.info(`${color.green("grafted")} ${task} onto ${config.trunk} (${head})`);
}

async function bump(worktree: Worktree): Promise<void> {
	await worktree.take({
		status: "working",
		graftAttempts: worktree.graftAttempts + 1,
	});
}

function tail(output: string): string {
	return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

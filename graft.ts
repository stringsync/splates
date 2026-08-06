import { color } from "@webappwiz/log";
import type { Ctx } from "./context";
import { fail } from "./exit";
import { conflictedPaths, currentBranch, git, gitOut, porcelain } from "./git";
import { acquire } from "./lock";
import {
	leaseIsLive,
	leaseIsOurs,
	ourLease,
	readState,
	type TaskState,
	writeState,
} from "./state";

const TAIL_LINES = 40;

/**
 * Lands the current worktree's branch on trunk. Despite the name this never
 * runs `git merge` in the merge-commit sense: it rebases onto trunk, runs the
 * tests there, and fast-forwards trunk. History stays linear.
 */
export async function graft(ctx: Ctx, cwd: string): Promise<void> {
	const branch = await currentBranch(ctx, cwd).catch(() => "");
	if (!branch.startsWith("task/")) {
		fail(
			ctx,
			"not_found",
			`not in a task worktree (branch '${branch}') — run graft from a worktree made by \`arbor create\``,
			{ branch },
		);
	}
	const task = branch.slice("task/".length);
	const state = await readState(ctx, task);
	if (!state) {
		fail(
			ctx,
			"not_found",
			`no state file for '${task}' — run \`arbor claim ${task}\` first`,
			{ task },
		);
	}

	const dirty = await porcelain(ctx, state.worktree);
	if (dirty.length > 0) {
		fail(
			ctx,
			"dirty",
			`'${task}' has uncommitted changes — commit them before grafting`,
			{ task, paths: dirty },
		);
	}
	if (state.graftAttempts >= ctx.config.graftRetryBudget) {
		fail(
			ctx,
			"budget_exhausted",
			`'${task}' has used its ${ctx.config.graftRetryBudget} graft attempts — run \`arbor escalate <reason>\` or \`arbor prune ${task}\` and start over against current ${ctx.config.trunk}`,
			{ task, graftAttempts: state.graftAttempts },
		);
	}
	if (leaseIsLive(ctx, state.lease) && !leaseIsOurs(ctx, state.lease)) {
		fail(
			ctx,
			"lease_live",
			`'${task}' is held by pid ${state.lease?.pid} on ${state.lease?.hostname} — another agent is driving this tree`,
			{ task, lease: state.lease },
		);
	}
	await writeState(ctx, { ...state, lease: ourLease(ctx) });

	// Blocks until free: an agent told "busy, try later" goes and edits code in
	// a branch that is supposed to be frozen.
	const lock = await acquire(ctx);
	await writeState(ctx, {
		...state,
		status: "grafting",
		lease: ourLease(ctx),
	});

	const before = await gitOut(ctx, state.worktree, "rev-parse", "HEAD");
	const rebase = await git(ctx, state.worktree, "rebase", ctx.config.trunk);
	if (rebase.code !== 0) {
		// Left in progress on purpose: the agent needs the conflict markers.
		const paths = await conflictedPaths(ctx, state.worktree);
		await lock.release();
		await bump(ctx, state, 1);
		fail(
			ctx,
			"conflict",
			[
				`rebase onto ${ctx.config.trunk} conflicted in ${paths.length || "?"} file(s):`,
				...paths.map((p) => `  ${p}`),
				"",
				"The rebase is still in progress. Resolve the conflicts, `git add` them,",
				"`git rebase --continue`, then run `arbor graft` again.",
				"If both sides restructured the same logic, prefer `arbor escalate <reason>`",
				`or \`arbor prune ${task}\` and redo the task against current ${ctx.config.trunk}.`,
			].join("\n"),
			{ task, paths },
		);
	}

	// After the rebase, never before: a branch that passed against an older
	// trunk tells you nothing about the combination. This is the only thing
	// standing between semantic conflicts and a broken trunk.
	const tests = await ctx.ps.spawnCapture(
		["sh", "-c", ctx.config.testCommand],
		{
			cwd: state.worktree,
			env: {
				...(process.env as Record<string, string>),
				ARBOR_TASK: task,
				ARBOR_PORT: String(state.port),
				ARBOR_WORKTREE: state.worktree,
			},
		},
	);
	if (tests.exitCode !== 0) {
		// The rebase already finished, so there is nothing for `rebase --abort`
		// to undo — resetting to the pre-rebase commit is what returns the branch
		// to its previous state.
		await git(ctx, state.worktree, "reset", "--hard", before);
		await lock.release();
		await bump(ctx, state, 1);
		fail(
			ctx,
			"tests_failed",
			[
				`\`${ctx.config.testCommand}\` failed after rebasing onto ${ctx.config.trunk} (exit ${tests.exitCode}).`,
				`${ctx.config.trunk} is untouched and ${branch} is back at ${before.slice(0, 8)}.`,
				"",
				tail(`${tests.stdout}\n${tests.stderr}`),
			].join("\n"),
			{ task, exitCode: tests.exitCode },
		);
	}

	// A long test run can outlive the lease; landing after someone else claimed
	// the tree would land work that is no longer ours.
	const current = await readState(ctx, task);
	if (!leaseIsOurs(ctx, current?.lease ?? null)) {
		await lock.release();
		fail(
			ctx,
			"lease_lost",
			`the lease on '${task}' was taken by pid ${current?.lease?.pid} during the graft — stopping without landing. Do not retry; another agent owns this tree.`,
			{ task, lease: current?.lease ?? null },
		);
	}

	const checkout = await git(ctx, ctx.root, "checkout", ctx.config.trunk);
	const merged =
		checkout.code === 0
			? await git(ctx, ctx.root, "merge", "--ff-only", branch)
			: checkout;
	if (merged.code !== 0) {
		await lock.release();
		await bump(ctx, state, 1);
		fail(
			ctx,
			"merge_failed",
			`could not fast-forward ${ctx.config.trunk} in ${ctx.root}: ${merged.stderr || merged.stdout}`,
			{ task },
		);
	}

	const head = await gitOut(ctx, ctx.root, "rev-parse", "--short", "HEAD");
	await writeState(ctx, {
		...state,
		status: "working",
		graftAttempts: 0,
		lease: ourLease(ctx),
	});
	await lock.release();
	ctx.log.info(
		`${color.green("grafted")} ${task} onto ${ctx.config.trunk} (${head})`,
	);
}

async function bump(ctx: Ctx, state: TaskState, by: number): Promise<void> {
	await writeState(ctx, {
		...state,
		status: "working",
		graftAttempts: state.graftAttempts + by,
		lease: ourLease(ctx),
	});
}

function tail(output: string): string {
	return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

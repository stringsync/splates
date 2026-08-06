import { color } from "@webappwiz/log";
import { branchFor, type Ctx, portFor, worktreeFor } from "./context";
import { fail } from "./exit";
import { branchExists, git } from "./git";
import { ourLease, readState, writeState } from "./state";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function create(ctx: Ctx, task: string): Promise<void> {
	if (!NAME.test(task)) {
		fail(
			ctx,
			"usage",
			`invalid task name '${task}': use lowercase letters, digits and dashes`,
			{ task },
		);
	}

	const branch = branchFor(task);
	const worktree = worktreeFor(ctx, task);

	if (
		(await readState(ctx, task).catch(() => null)) ||
		(await ctx.fs.exists(worktree))
	) {
		fail(
			ctx,
			"exists",
			`task '${task}' already exists — run \`arbor claim ${task}\``,
			{
				task,
				worktree,
			},
		);
	}
	if (await branchExists(ctx, branch)) {
		fail(
			ctx,
			"exists",
			`branch ${branch} exists without a worktree — run \`arbor prune ${task}\` first`,
			{ task, branch },
		);
	}

	await ctx.fs.mkdir(ctx.config.worktreeRoot);
	const added = await git(
		ctx,
		ctx.root,
		"worktree",
		"add",
		"-b",
		branch,
		worktree,
		ctx.config.trunk,
	);
	if (added.code !== 0) {
		fail(ctx, "usage", `git worktree add failed: ${added.stderr}`, { task });
	}

	const port = portFor(task, ctx.config.portRange);
	const now = new Date().toISOString();
	await writeState(ctx, {
		task,
		branch,
		worktree,
		status: "working",
		lease: ourLease(ctx),
		port,
		graftAttempts: 0,
		createdAt: now,
		updatedAt: now,
	});

	// A fresh worktree shares no untracked files with the repo: no node_modules,
	// no .env. That is what the hook is for.
	if (ctx.config.postCreate) {
		const { exitCode } = await ctx.ps.spawn(
			["sh", "-c", ctx.config.postCreate],
			{
				cwd: worktree,
				env: {
					...(process.env as Record<string, string>),
					ARBOR_TASK: task,
					ARBOR_PORT: String(port),
					ARBOR_WORKTREE: worktree,
					ARBOR_TRUNK: ctx.config.trunk,
				},
			},
		);
		if (exitCode !== 0) {
			// The worktree stays. Rolling back would throw away a tree the agent
			// can fix by hand and re-run the hook in.
			fail(
				ctx,
				"hook_failed",
				`postCreate hook failed (exit ${exitCode}); worktree left in place at ${worktree}`,
				{ task, worktree, port },
			);
		}
	}

	ctx.log.info(
		`${color.green("created")} ${task}\n  worktree: ${worktree}\n  branch:   ${branch}\n  port:     ${port}`,
	);
}

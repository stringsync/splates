import { color } from "@webappwiz/log";
import { branchFor, type Ctx, worktreeFor } from "./context";
import { fail } from "./exit";
import { branchExists, commitsAhead, git } from "./git";
import { leaseIsLive, leaseIsOurs, readState, removeState } from "./state";

/**
 * Discards a whole workstream — worktree, branch and record. Unrelated to
 * `git worktree prune`, which only tidies stale metadata.
 *
 * Throwing a task away and redoing it against current trunk is usually cheaper
 * than a hard rebase, so this is meant to be used freely.
 */
export async function prune(
	ctx: Ctx,
	task: string,
	{ force = false }: { force?: boolean } = {},
): Promise<void> {
	const branch = branchFor(task);
	const state = await readState(ctx, task).catch(() => null);
	const worktree = state?.worktree ?? worktreeFor(ctx, task);
	const hadWorktree = await ctx.fs.exists(worktree);
	const hadBranch = await branchExists(ctx, branch);
	const hadState = await ctx.fs.exists(`${ctx.tasksDir}/${task}.json`);
	const tombstone = `${ctx.prunedDir}/${task}`;

	if (!hadWorktree && !hadBranch && !hadState) {
		const pruned = await ctx.fs.exists(tombstone);
		fail(
			ctx,
			pruned ? "already_pruned" : "not_found",
			pruned
				? `'${task}' was already pruned (${(await ctx.fs.read(tombstone)).trim()}) — nothing left to remove`
				: `no worktree, branch or state file named '${task}' — it never existed here`,
			{ task },
		);
	}

	if (
		state &&
		leaseIsLive(ctx, state.lease) &&
		!leaseIsOurs(ctx, state.lease)
	) {
		if (!force) {
			fail(
				ctx,
				"lease_live",
				`'${task}' is held by pid ${state.lease?.pid} on ${state.lease?.hostname} — pass --force to discard it anyway`,
				{ task, lease: state.lease },
			);
		}
		ctx.log.error(
			color.yellow(
				`arbor: --force discarding a tree held by pid ${state.lease?.pid}`,
			),
		);
	}

	const unlanded = hadBranch ? await commitsAhead(ctx, branch) : 0;

	if (hadWorktree) {
		const removed = await git(
			ctx,
			ctx.root,
			"worktree",
			"remove",
			worktree,
			"--force",
		);
		if (removed.code !== 0) {
			fail(ctx, "usage", `git worktree remove failed: ${removed.stderr}`, {
				task,
			});
		}
	} else {
		// Directory gone by other means: drop the metadata git still holds.
		await git(ctx, ctx.root, "worktree", "prune");
	}
	if (hadBranch) {
		const deleted = await git(ctx, ctx.root, "branch", "-D", branch);
		if (deleted.code !== 0) {
			fail(ctx, "usage", `git branch -D failed: ${deleted.stderr}`, { task });
		}
	}
	await removeState(ctx, task);
	await ctx.fs.write(tombstone, `${new Date().toISOString()}\n`);
	await trimTombstones(ctx);

	const lines = [
		`${color.green("pruned")} ${task}`,
		`  worktree: ${hadWorktree ? worktree : "already gone"}`,
		`  branch:   ${hadBranch ? branch : "already gone"}`,
		`  state:    ${hadState ? "removed" : "already gone"}`,
	];
	if (unlanded) {
		lines.push(
			color.yellow(
				`  discarded ${unlanded} commit(s) that were never on ${ctx.config.trunk}`,
			),
		);
	}
	ctx.log.info(lines.join("\n"));
}

// ponytail: a flat cap, no age policy. The ledger only answers "was this task
// pruned before?", so losing the oldest entries costs a nicer message and
// nothing else. Make it a config key if anyone ever wants a different depth.
const TOMBSTONE_LIMIT = 100;

/** Drops the oldest tombstones so the ledger cannot grow without bound. */
export async function trimTombstones(
	ctx: Ctx,
	limit = TOMBSTONE_LIMIT,
): Promise<void> {
	const names = await ctx.fs.readdir(ctx.prunedDir).catch(() => []);
	if (names.length <= limit) {
		return;
	}
	// The file's contents are the ISO timestamp we wrote, which sorts
	// chronologically. An unreadable one sorts first and goes first.
	const dated = await Promise.all(
		names.map(async (name) => ({
			name,
			at: (
				await ctx.fs.read(`${ctx.prunedDir}/${name}`).catch(() => "")
			).trim(),
		})),
	);
	dated.sort((a, b) => a.at.localeCompare(b.at));
	for (const { name } of dated.slice(0, names.length - limit)) {
		await ctx.fs.rm(`${ctx.prunedDir}/${name}`, { force: true });
	}
}

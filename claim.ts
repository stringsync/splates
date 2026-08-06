import { color } from "@webappwiz/log";
import { branchFor, type Ctx, portFor, worktreeFor } from "./context";
import { fail } from "./exit";
import { interruptedOps, porcelain } from "./git";
import {
	leaseIsLive,
	leaseIsOurs,
	ourLease,
	readState,
	type TaskState,
	writeState,
} from "./state";

/** The resume entry point: a fresh agent thread picking up existing work. */
export async function claim(ctx: Ctx, task: string): Promise<void> {
	const worktree = worktreeFor(ctx, task);
	const onDisk = await ctx.fs.exists(worktree);
	let state: TaskState | null;
	try {
		state = await readState(ctx, task);
	} catch (e) {
		if (!onDisk) {
			throw e;
		}
		state = null; // corrupt record, but the tree is there — rebuild below
	}

	if (!state && !onDisk) {
		fail(ctx, "not_found", `no task '${task}' — run \`arbor create ${task}\``, {
			task,
		});
	}
	if (state && !onDisk) {
		fail(
			ctx,
			"orphaned",
			`state file for '${task}' has no worktree at ${worktree} — run \`arbor prune ${task}\``,
			{ task, worktree },
		);
	}
	if (
		state &&
		leaseIsLive(ctx, state.lease) &&
		!leaseIsOurs(ctx, state.lease)
	) {
		fail(
			ctx,
			"lease_live",
			`'${task}' is held by pid ${state.lease?.pid} on ${state.lease?.hostname} (heartbeat ${state.lease?.heartbeatAt}) — another agent is driving this tree`,
			{ task, lease: state.lease },
		);
	}

	const now = new Date().toISOString();
	const claimed: TaskState = {
		...(state ?? {
			// Reconstructed from disk: a worktree with no record is still work.
			task,
			// By construction; HEAD may be detached mid-rebase, so don't ask git.
			branch: branchFor(task),
			worktree,
			status: "working" as const,
			port: portFor(task, ctx.config.portRange),
			graftAttempts: 0,
			createdAt: now,
		}),
		lease: ourLease(ctx),
		updatedAt: now,
	};
	await writeState(ctx, claimed);

	const interrupted = await interruptedOps(ctx, worktree);
	const changes = await porcelain(ctx, worktree);
	const lines = [
		`${color.green("claimed")} ${claimed.task}`,
		`  worktree: ${worktree}`,
		`  branch:   ${claimed.branch}`,
		`  port:     ${claimed.port}`,
		`  status:   ${claimed.status}`,
		`  attempts: ${claimed.graftAttempts}`,
	];
	if (!state) {
		lines.push(`  ${color.yellow("note: state file rebuilt from disk")}`);
	}
	if (interrupted.length > 0) {
		lines.push(
			`  ${color.red(`interrupted git operation: ${interrupted.join(", ")}`)}`,
			"  resolve it before grafting — you are standing in a half-finished operation",
		);
	}
	lines.push(
		changes.length === 0
			? "  uncommitted: none"
			: `  uncommitted (${changes.length}):\n${changes.map((c) => `    ${c}`).join("\n")}`,
	);
	ctx.log.info(lines.join("\n"));
}

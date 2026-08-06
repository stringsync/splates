import { color } from "@webappwiz/log";
import type { Arbor } from "../lib/arbor";

/** The resume entry point: a fresh agent thread picking up existing work. */
export async function claim(arbor: Arbor, task: string): Promise<void> {
	const found = await arbor.store.find(task);

	if (found.gone) {
		arbor.fail(
			"not_found",
			`no task '${task}' — run \`arbor create ${task}\``,
			{
				task,
			},
		);
	}
	if (found.status === "orphaned") {
		arbor.fail(
			"orphaned",
			`state file for '${task}' has no worktree at ${found.path} — run \`arbor prune ${task}\``,
			{ task, worktree: found.path },
		);
	}
	if (found.status === "stray") {
		arbor.fail(
			"orphaned",
			`branch ${found.branch} exists but has no worktree — run \`arbor prune ${task}\` and start over`,
			{ task, branch: found.branch },
		);
	}
	if (found.leaseHeld) {
		arbor.fail(
			"lease_live",
			`'${task}' is held by pid ${found.lease?.pid} on ${found.lease?.hostname} (heartbeat ${found.lease?.heartbeatAt}) — another agent is driving this tree`,
			{ task, lease: found.lease },
		);
	}

	// A worktree with no readable record is still work: `save` writes a fresh
	// one rather than refusing the resume.
	const rebuilt = found.state === null;
	const worktree = await found.take();

	const interrupted = await worktree.interruptedOps();
	const changes = await worktree.uncommitted();
	const lines = [
		`${color.green("claimed")} ${worktree.task}`,
		`  worktree: ${worktree.path}`,
		`  branch:   ${worktree.branch}`,
		`  port:     ${worktree.port}`,
		`  status:   ${worktree.status}`,
		`  attempts: ${worktree.graftAttempts}`,
	];
	if (rebuilt) {
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
	arbor.log.info(lines.join("\n"));
}

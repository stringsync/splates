import { color, type Logger } from "@webappwiz/log";
import { fail } from "./exit";
import type { WorktreeService } from "./worktree-service";

/** The resume entry point: a fresh agent thread picking up existing work. */
export async function claim(
	{ service, log }: { service: WorktreeService; log: Logger },
	task: string,
): Promise<void> {
	const found = await service.find(task);

	if (found.gone) {
		fail("not_found", `no task '${task}': run \`arbor add ${task}\``, {
			task,
		});
	}
	if (found.status === "orphaned") {
		fail(
			"orphaned",
			`state file for '${task}' has no worktree at ${found.path}: run \`arbor rm ${task}\``,
			{ task, worktree: found.path },
		);
	}
	if (found.status === "stray") {
		fail(
			"orphaned",
			`branch ${found.branch} exists but has no worktree: run \`arbor rm ${task}\` and start over`,
			{ task, branch: found.branch },
		);
	}
	if (found.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${task}' is held by pid ${found.lease?.pid} on ${found.lease?.hostname} (heartbeat ${found.lease?.heartbeatAt}): another agent is driving this tree`,
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
		`  status:   ${worktree.status}`,
		`  attempts: ${worktree.mergeAttempts}`,
	];
	if (rebuilt) {
		lines.push(`  ${color.yellow("note: state file rebuilt from disk")}`);
	}
	if (interrupted.length > 0) {
		lines.push(
			`  ${color.red(`interrupted git operation: ${interrupted.join(", ")}`)}`,
			"  resolve it before merging: you are standing in a half-finished operation",
		);
	}
	lines.push(
		changes.length === 0
			? "  uncommitted: none"
			: `  uncommitted (${changes.length}):\n${changes.map((change) => `    ${change}`).join("\n")}`,
	);
	log.info(lines.join("\n"));
}

import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { fail } from "../exit";
import type { TaskBranches } from "../merge";
import { goalOf, Plans } from "../plans";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * The resume entry point: a fresh agent thread picking up existing work. Its
 * merge budget stays as it was, which only `retry` refills.
 */
export async function claim(
	{
		service,
		log,
		fs,
		branches,
	}: {
		service: WorktreeService;
		log: Logger;
		fs: Fs;
		branches: TaskBranches;
	},
	task: string,
): Promise<{ goal: string }> {
	let found = await service.find(task);

	if (found.gone) {
		fail("not_found", `no task '${task}': run \`splates add ${task}\``, {
			task,
		});
	}
	// A remote worker picks a task up from its pushed branch, wherever its
	// last checkout was, once nobody there drives it.
	if (service.elsewhere(found)) {
		refuseHeld(found);
		const resumed = await service.resume(found);
		if (resumed.code !== 0) {
			fail(
				"orphaned",
				`could not clone '${task}' again from its pushed branch: ${resumed.stderr || resumed.stdout}`,
				{ task },
			);
		}
		found = await service.find(task);
		await new Plans(fs).exclude(await found.git.commonDir());
		// The clone has the branch, not the plan, which stayed in repo state.
		await branches.restorePlan(found);
	}
	if (found.status === "orphaned") {
		fail(
			"orphaned",
			`state file for '${task}' has no worktree at ${found.path}: run \`splates remove ${task}\``,
			{ task, worktree: found.path },
		);
	}
	if (found.status === "stray") {
		fail(
			"orphaned",
			`branch ${found.branch} exists but has no worktree: run \`splates remove ${task}\` and start over`,
			{ task, branch: found.branch },
		);
	}
	refuseHeld(found);

	// A worktree with no readable record is still work: `save` writes a fresh
	// one rather than refusing the resume.
	const rebuilt = found.state === null;
	const worktree = await found.take({});

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
	// What the page shows as the task the conversation is now on.
	const plan = (await new Plans(fs).read(worktree.path)) ?? "";
	return { goal: goalOf(plan) };
}

/** Refuses a task another agent holds the lease on. */
function refuseHeld(found: Worktree): void {
	if (found.leaseHeldByOther) {
		fail(
			"lease_held",
			`'${found.task}' is held by pid ${found.lease?.pid} on ${found.lease?.hostname} (heartbeat ${found.lease?.heartbeatAt}): another agent is driving this tree`,
			{ task: found.task, lease: found.lease },
		);
	}
}

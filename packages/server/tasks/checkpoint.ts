import { color, type Logger } from "webappwiz/log";
import { fail } from "../exit";
import type { Git } from "../git";
import { pushedLine, type TaskBranches } from "../task-branches";
import type { WorktreeService } from "./worktree-service";

/** The message of the commit a checkpoint saves uncommitted work in. */
export const WIP_MESSAGE = "WIP: checkpoint";

/** What a checkpoint did. */
export interface Checkpointed {
	task: string;
	/** Whether it committed work that was uncommitted. */
	committed: boolean;
	/** Whether the remote has the branch as it now stands. */
	pushed: boolean;
}

/**
 * Saves the task `cwd` is a worktree of to the central remote, as before a
 * restart: commits what is uncommitted as a WIP commit, which the agent
 * squashes before merging, then pushes the branch, so a worker that dies
 * now loses nothing. Mid-rebase it commits nothing, and pushes the branch
 * as it stood before the rebase. With no remote configured, this tree is
 * the only copy, so it leaves it as it is.
 */
export async function checkpoint(
	{
		service,
		git,
		log,
		branches,
	}: {
		service: WorktreeService;
		git: Git;
		log: Logger;
		branches: TaskBranches;
	},
	cwd: string,
): Promise<Checkpointed> {
	const branch = await git.currentBranch(cwd);
	const interrupted = await git.interruptedOps(cwd);
	// A rebase detaches HEAD, so the tree's task is the one whose tree it is.
	const top = (await git.run(cwd, "rev-parse", "--show-toplevel")).stdout;
	const task =
		service.taskFor(branch) ??
		(await service.list()).find((each) => each.path === top)?.task ??
		null;
	if (task === null) {
		fail(
			"usage",
			"not in a task worktree: run checkpoint from a worktree made by `splates add`",
			{ branch },
		);
	}
	const worktree = await service.find(task);
	if (branches.remote() === null) {
		log.info(
			[
				`${color.green("checkpointed")} ${task}`,
				"  remote:   none configured (`remote` in splates.config.ts), so this tree is the task's only copy",
			].join("\n"),
		);
		return { task, committed: false, pushed: false };
	}
	const dirty =
		interrupted.length === 0 && (await git.porcelain(cwd)).length > 0;
	if (dirty) {
		const committed = await git.commitAll(cwd, WIP_MESSAGE);
		if (committed.code !== 0) {
			fail(
				"usage",
				`could not commit '${task}' as ${WIP_MESSAGE}: ${committed.stderr || committed.stdout}`,
				{ task },
			);
		}
	}
	const pushed = await branches.pushTree(worktree);
	log.info(
		[
			`${color.green("checkpointed")} ${task}`,
			dirty
				? `  committed: uncommitted work as "${WIP_MESSAGE}": squash it before merging`
				: interrupted.length > 0
					? `  committed: nothing, with a ${interrupted.join(" and ")}`
					: "  committed: nothing left uncommitted",
			pushedLine(pushed, "pushed") ?? "",
		]
			.filter(Boolean)
			.join("\n"),
	);
	return { task, committed: dirty, pushed: pushed.status === "pushed" };
}

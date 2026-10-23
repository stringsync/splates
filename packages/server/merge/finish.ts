import { color, type Logger } from "webappwiz/log";
import type { Tasks } from "../board";
import type { Config } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import { freedLine, type Slots } from "../ports";
import type { Facts } from "../records";
import type { DiffSize, Worktree, WorktreeService } from "../tasks";
import { recommend, recommendation } from "../tasks";
import { pushedLine, type TaskBranches } from "./branches";
import type { TimedTest } from "./test-report";
import type { MergeTiming } from "./timing";
import type { Landed } from "./trunk";

/** What a merge landed, as `finishLanding` ends it with. */
export interface Landing {
	/** The task's checkout, about to go. */
	current: Worktree;
	/** The commit the task landed as, short. */
	head: string;
	/** The checkout the base is checked out in, where it moved. */
	landing: string;
	/** The remote landing, or null for a local one. */
	landed: Extract<Landed, { status: "landed" }> | null;
	changed: string[];
	commits: string[] | undefined;
	size: DiffSize | undefined;
	testTimes: TimedTest[];
}

/**
 * Ends a merge whose work is on the base: discards the worktree, frees its
 * slot, drops any pushed branch, takes the queued tasks it took off the list
 * and says what to report. A batch's followers end here as its leader does.
 */
export async function finishLanding(
	{
		service,
		git,
		config,
		log,
		tasks,
		slots,
		branches,
		timing,
	}: {
		service: WorktreeService;
		git: Git;
		config: Config;
		log: Logger;
		tasks: Tasks;
		slots: Slots;
		branches: TaskBranches;
		timing: MergeTiming;
	},
	landing: Landing,
	facts: Partial<Facts["merge"]>,
): Promise<void> {
	const { current, head, landed, changed, commits, size, testTimes } = landing;
	const { task, base } = current;
	const remote = base === config.trunk ? branches.remote() : null;
	facts.commit = head;
	facts.files = changed;
	// The work is on the base, so the tree has nothing left to hold. Discarding it
	// here is what keeps `splates list` a list of live work rather than a graveyard
	// of landed tasks.
	//
	// Step out of it first: merge usually runs from inside the tree it is about
	// to delete, and spawning git from a directory that no longer exists fails
	// with ENOENT before git is even reached.
	service.ps.cd(git.root);
	const discarded = await current.discard("merged", {
		commit: head,
		commits,
		size,
		testTimes,
		merge: timing.times,
	});
	if (discarded.code !== 0) {
		fail(
			"usage",
			`landed '${task}' on ${base} (${head}) but could not discard its worktree: ${discarded.stderr || discarded.stdout}\nRun \`splates remove ${task}\` to clean up.`,
			{ task },
		);
	}
	const freed = await slots.release(current.path);
	// Landed is landed: a remote that kept its copy only has a stray branch.
	const unpushed = pushedLine(await branches.delete(task), "deleted");
	// Done is done: the queued tasks this task took up leave the queue with it.
	const done = await tasks.takenBy(task);
	// Read before the queued tasks go, since a lane they empty ends with them.
	const ran = (await tasks.lanes()).filter((lane) =>
		done.some((each) => each.lane === lane.id),
	);
	for (const each of done) {
		await each.remove(head);
	}
	await tasks.endLanes(ran.map((lane) => lane.id));
	const lines = [
		`${color.green("merged")} ${task} onto ${base} (${head})${
			landing.landing === git.root ? "" : `\n  landed in: ${landing.landing}`
		}\n  worktree removed, cd ${git.root}`,
		// Merge stepped out of the tree, but it cannot move the shell that
		// ran it, always in that tree, nor an agent session opened there.
		color.yellow(
			`  your shell is still in the removed ${current.path}: \`cd ${git.root}\` before running anything else`,
		),
		...(landed !== null && landed.local !== "moved"
			? [
					color.yellow(
						`  ${base} here could not follow ${remote}: ${landed.local.stuck}\n  It landed on ${remote}; bring this checkout up with \`git pull --ff-only\`.`,
					),
				]
			: []),
		...(facts.batch === undefined
			? []
			: [
					`  gated in one batch with ${facts.batch.filter((each) => each !== task).join(", ")}`,
				]),
		...(freed === null ? [] : [`  slot ${freedLine(freed)}`]),
		...(unpushed === null ? [] : [unpushed]),
		...done.map((each) => `  done task ${each.id}: ${each.subject}`),
	];
	// Only a landing on trunk ends a piece of work. A part landing on its
	// parent's branch hands back to that parent, which is not done yet.
	if (landing.landing === git.root) {
		lines.push(
			...recommendation(
				await recommend(tasks, task, config.taskStalenessMs, ran),
			),
			// Last, since it is what the agent writes next: the page
			// shows the merge as a card only under this title.
			"",
			`${color.bold("report it")} as \`## ✅ Merged ${task} onto ${base}\`, then a line on what changed for the user; ask and offer nothing`,
		);
	}
	log.info(lines.join("\n"));
}

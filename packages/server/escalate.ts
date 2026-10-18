import { color, type Logger } from "webappwiz/log";
import type { Fs, Lock } from "webappwiz/system";
import { fail } from "./exit";
import type { Git } from "./git";
import { Plans, questions, ready, unfinished, whatIsLeft } from "./plan";
import type { Facts } from "./records";
import { pushedLine, type TaskBranches } from "./task-branches";
import type { Escalation } from "./worktree";
import type { WorktreeService } from "./worktree-service";

export interface EscalateOptions {
	/** Task to escalate. Defaults to the one `cwd` is a worktree for. */
	task?: string;
	/**
	 * Ask a person to approve merging, rather than to answer questions, with
	 * the reason as what to look at. Refused until the task is ready to merge:
	 * every question under `## Blocked` and step under `## Next` checked.
	 */
	review?: boolean;
}

/**
 * The way out that is not "resolve the conflict badly to finish the task".
 * When both sides restructured the same logic there is no correct merge, only
 * a decision, and that belongs to a human.
 */
export async function escalate(
	{
		service,
		git,
		lock,
		log,
		fs,
		branches,
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		log: Logger;
		fs: Fs;
		branches: TaskBranches;
	},
	reason: string,
	cwd: string,
	{ task, review = false }: EscalateOptions = {},
): Promise<Facts["escalate"]> {
	const branch = await git.currentBranch(cwd);
	const name = task || service.taskFor(branch);
	if (!name) {
		fail(
			"usage",
			"not in a task worktree: pass --task <name> to escalate from elsewhere",
		);
	}
	const found = await service.find(name);
	if (!found.state) {
		fail("not_found", `no state file for '${name}'`, { task: name });
	}

	const plan = (await new Plans(fs).read(found.path)) ?? "";
	if (review) {
		// A review is the one thing left: approve it and the task lands.
		const left = unfinished(plan);
		if (!ready(left)) {
			fail(
				"blocked",
				`'${name}' is not ready to merge: ${whatIsLeft(left)}. Escalate without --review to ask the questions, and finish or \`splates todo add\` the steps, then ask for the review`,
				{ task: name, blocked: left.questions, steps: left.steps },
			);
		}
	}
	const escalations: Escalation[] = [
		...(found.state.escalations ?? []),
		{
			reason,
			at: new Date().toISOString(),
			...(review ? { review: true } : {}),
		},
	];
	// The worktree is left exactly as it is: a human needs to see what the
	// agent saw, conflict markers and all.
	const worktree = await found.save({
		status: "escalated",
		lease: null,
		escalations,
	});
	await lock.releaseIfOurs();
	// What it waits on a person with is what a worker that dies meanwhile
	// would lose, so the remote gets it as committed; the tree itself is left
	// as the agent left it, uncommitted work and all, for the person to see.
	const pushed = pushedLine(await branches.pushTree(worktree), "pushed");

	log.info(
		[
			`${color.yellow("escalated")} ${worktree.task}`,
			`  worktree: ${worktree.path}`,
			`  branch:   ${worktree.branch}`,
			`  reason:   ${reason}`,
			review ? "  review:   ready to merge once a person approves" : "",
			pushed ?? "",
			escalations.length > 1
				? `  (${escalations.length} escalations recorded)`
				: "",
			"",
			"Left untouched for a human. Stop working on this task.",
		]
			.filter(Boolean)
			.join("\n"),
	);
	return {
		about: reason,
		review,
		base: worktree.base,
		questions: questions(plan).filter((asked) => !asked.done),
	};
}

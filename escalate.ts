import { color, type Logger } from "webappwiz/log";
import type { Fs, Lock } from "webappwiz/system";
import { fail } from "./exit";
import type { Git } from "./git";
import { PLAN_FILE, questions, withQuestion } from "./plan";
import type { WorktreeService } from "./worktree-service";

export interface EscalateOptions {
	/** Task to escalate. Defaults to the one `cwd` is a worktree for. */
	task?: string;
	/**
	 * Ask a person to approve merging, rather than to answer questions: adds
	 * the question that asks it to the plan, with the reason as its detail.
	 * Refused while another question is unchecked.
	 */
	review?: boolean;
}

/** The question a review asks. */
export const REVIEW_SUBJECT = "Ready to merge?";

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
	}: {
		service: WorktreeService;
		git: Git;
		lock: Lock;
		log: Logger;
		fs: Fs;
	},
	reason: string,
	cwd: string,
	{ task, review = false }: EscalateOptions = {},
): Promise<void> {
	const branch = await git.currentBranch(cwd).catch(() => "");
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

	let asked: string | undefined;
	if (review) {
		const path = `${found.path}/${PLAN_FILE}`;
		const plan = await fs.read(path).catch(() => "");
		const unchecked = questions(plan)
			.filter((question) => !question.done)
			.map((question) => question.number);
		// A review is the one thing left: approve it and the task lands.
		if (unchecked.length > 0) {
			fail(
				"blocked",
				`'${name}' has questions ${unchecked.join(", ")} unchecked under ## Blocked: settle those first, or escalate without --review to ask them`,
				{ task: name, blocked: unchecked },
			);
		}
		const added = withQuestion(plan, REVIEW_SUBJECT, reason);
		await fs.write(path, added.plan);
		asked = added.number;
	}
	const escalations = [
		...(found.state.escalations ?? []),
		{
			reason,
			at: new Date().toISOString(),
			...(asked === undefined ? {} : { review: asked }),
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

	log.info(
		[
			`${color.yellow("escalated")} ${worktree.task}`,
			`  worktree: ${worktree.path}`,
			`  branch:   ${worktree.branch}`,
			`  reason:   ${reason}`,
			asked === undefined
				? ""
				: `  review:   question ${asked} asks to approve merging`,
			escalations.length > 1
				? `  (${escalations.length} escalations recorded)`
				: "",
			"",
			"Left untouched for a human. Stop working on this task.",
		]
			.filter(Boolean)
			.join("\n"),
	);
}

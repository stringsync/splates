import { color, type Logger } from "webappwiz/log";
import type { Config } from "../config";
import { fail } from "../exit";
import type { Journal } from "../records";
import type { Worktree } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/**
 * The way back from `budget_exhausted`. A task that has spent its merge
 * attempts or its conflicted rebases gets both budgets back whole, instead of
 * `remove` and redo.
 *
 * Only once they are spent, and only for a person: the budget's whole job is
 * to make an agent stop and ask. An agent that granted itself more would be
 * back to grinding against a moving trunk forever, so the skill leaves it to
 * the person, who has looked at the tree first.
 */
export async function retry(
	{
		service,
		config,
		log,
	}: { service: WorktreeService; config: Config; log: Logger },
	task: string,
): Promise<Granted> {
	const granted = await grantRetry(service, task);
	const { worktree } = granted;

	log.info(
		[
			`${color.green("retry")} ${worktree.task}`,
			`  attempts: 0 of ${config.mergeRetryCount}`,
			`  status:   working`,
			"",
			`Run \`splates claim ${worktree.task}\` to pick it up.`,
		].join("\n"),
	);
	return granted;
}

/** `retry`, recorded in the journal with the attempts the task had spent. */
export function recordRetry(
	ctx: {
		journal: Journal;
		service: WorktreeService;
		config: Config;
		log: Logger;
	},
	task: string,
): Promise<Granted> {
	return ctx.journal.record(
		"retry",
		task,
		() => retry(ctx, task),
		({ attempts }) => ({ attempts }),
	);
}

/** A retry that was granted: the task back to working, and the attempts it had spent. */
export interface Granted {
	worktree: Worktree;
	/** The merge attempts it had spent before the grant. */
	attempts: number;
}

/** What `retry` does, without the printing, for `splates server`'s page too. */
export async function grantRetry(
	service: WorktreeService,
	task: string,
): Promise<Granted> {
	const found = await service.find(task);
	if (found.gone) {
		fail("not_found", `no task '${task}'`, { task });
	}
	if (!found.budgetSpent) {
		fail(
			"usage",
			`'${task}' has spent ${found.mergeAttempts} of its ${found.mergeAttemptLimit} merge attempts and ${found.conflictAttempts} of its ${found.conflictAttemptLimit} conflicted rebases: only a task that spent one budget can be granted more`,
			{ task, attempts: found.mergeAttempts },
		);
	}

	// Whoever picks the task up takes it with `claim`, the same as any other
	// resume.
	return {
		worktree: await found.save({
			status: "working",
			mergeAttempts: 0,
			conflictAttempts: 0,
			retries: (found.state?.retries ?? 0) + 1,
		}),
		attempts: found.mergeAttempts,
	};
}

import { color, type Logger } from "@webappwiz/log";
import type { Config } from "./config";
import { fail } from "./exit";
import type { WorktreeStore } from "./worktree-store";

/**
 * The way back from `budget_exhausted`. A task that has spent its merge
 * attempts gets another `mergeRetryCount` of them, instead of `rm` and redo.
 *
 * Only from `escalated`, and deliberately: the budget's whole job is to make an
 * agent stop and hand the task over. An agent that could grant itself more
 * would be back to grinding against a moving trunk forever, so the price of a
 * fresh budget is that a human has looked at the tree first.
 */
export async function retry(
	{ store, config, log }: { store: WorktreeStore; config: Config; log: Logger },
	task: string,
): Promise<void> {
	const found = await store.find(task);
	if (found.gone) {
		fail("not_found", `no task '${task}'`, { task });
	}
	if (found.status !== "escalated") {
		fail(
			"usage",
			`'${task}' is ${found.status}, not escalated: only a task handed to a human can be granted more merge attempts`,
			{ task, status: found.status },
		);
	}

	// The lease stays as escalate left it: whoever picks the task up takes it
	// with `claim`, the same as any other resume.
	const worktree = await found.save({ status: "working", mergeAttempts: 0 });

	log.info(
		[
			`${color.green("retry")} ${worktree.task}`,
			`  attempts: 0 of ${config.mergeRetryCount}`,
			`  status:   working`,
			"",
			`Run \`arbor claim ${worktree.task}\` to pick it up.`,
		].join("\n"),
	);
}

import type { Fs } from "webappwiz/system";
import { PLAN_FILE, type Question, questions } from "./plan";
import type { WorktreeService } from "./worktree-service";

/** A question an escalated task is waiting on, with the task that asked it. */
export interface Blocker extends Question {
	task: string;
}

/**
 * Every question under `## Blocked` in the plans of escalated tasks that
 * nobody has answered, by task name and then in the order each plan lists
 * them. A task still at work asks in its chat instead, and an answered
 * question is its agent's to act on, so neither is shown.
 */
export async function blockers({
	service,
	fs,
}: {
	service: WorktreeService;
	fs: Fs;
}): Promise<Blocker[]> {
	const found: Blocker[] = [];
	for (const worktree of await service.list()) {
		if (worktree.status !== "escalated" || !worktree.exists) {
			continue;
		}
		const plan = await fs
			.read(`${worktree.path}/${PLAN_FILE}`)
			.catch(() => null);
		for (const question of questions(plan ?? "")) {
			if (!question.done && question.reply === null) {
				found.push({ task: worktree.task, ...question });
			}
		}
	}
	return found;
}

import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import { fail } from "./exit";
import { formatQuestion } from "./inbox";
import { PLAN_FILE, type Question, questions } from "./plan";
import type { Worktree, WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** How long `wait` gives a task before handing the wait back to its caller. */
export const DEFAULT_TIMEOUT = Duration.mins(5);

/** How often the task's record is re-read. Cheap: a file and two git refs. */
const POLL = Duration.secs(2);

/** The only two statuses a task moves on from by itself. */
const RUNNING: WorktreeStatus[] = ["working", "merging"];

export interface WaitOptions {
	/** How long to wait before giving up. */
	timeout?: Duration;
	/** How long between reads of the record; the default suits a human's patience. */
	poll?: Duration;
	/**
	 * Wait for the task's open questions to be answered instead of for the task
	 * to stop moving: what an agent that escalated waits on.
	 */
	answered?: boolean;
}

/**
 * Blocks until a task stops moving: merged or removed (both leave the name
 * `removed`), escalated to a human, or broken. Waiting is for the agent whose
 * own work overlaps this one's and would rather rebase onto the result than
 * against it, which is why the timeout is short enough to come back and think
 * again rather than block a session for an afternoon.
 *
 * With `answered` it blocks instead until every open question under the
 * task's `## Blocked` has a reply, then prints them: the agent that escalated
 * waits for its human this way, rather than polling its own plan.
 */
export async function wait(
	{ service, log, fs }: { service: WorktreeService; log: Logger; fs: Fs },
	task: string,
	{
		timeout = DEFAULT_TIMEOUT,
		poll = POLL,
		answered = false,
	}: WaitOptions = {},
): Promise<void> {
	const deadline = Date.now() + timeout.ms;
	for (;;) {
		const worktree = await service.find(task);
		// `removed` is a task that landed or was discarded, and is what waiting
		// for one usually ends in. `absent` is a name nothing remembers, which
		// is a typo, not an ending.
		if (worktree.status === "absent") {
			fail(
				"not_found",
				`no task '${task}': run \`arbor list\` to see what there is`,
				{ task },
			);
		}
		// A tree that is gone has no questions left to answer, so either kind of
		// waiting ends there.
		if (answered && !worktree.exists) {
			log.info(report(worktree));
			return;
		}
		const open = answered ? await pending(fs, worktree) : [];
		const unanswered = open
			.filter((question) => question.reply === null)
			.map((question) => question.number);
		if (answered && unanswered.length === 0) {
			log.info(replies(worktree, open));
			return;
		}
		if (!answered && !RUNNING.includes(worktree.status)) {
			log.info(report(worktree));
			return;
		}
		const left = deadline - Date.now();
		if (left <= 0) {
			fail(
				"timeout",
				answered
					? `'${task}' still has ${unanswered.join(", ")} unanswered after ${timeout.secs}s: wait again, or tell the human what the answers are blocking`
					: `'${task}' is still ${worktree.status} after ${timeout.secs}s: wait again, work alongside it and accept the rebase, or ask the human`,
				answered
					? { task, status: worktree.status, unanswered }
					: { task, status: worktree.status },
			);
		}
		await sleep(Duration.min(poll, Duration.ms(left)));
	}
}

/** The open questions in a task's plan; a tree with no plan asks none. */
async function pending(fs: Fs, worktree: Worktree): Promise<Question[]> {
	const plan = await fs.read(`${worktree.path}/${PLAN_FILE}`).catch(() => "");
	return questions(plan).filter((question) => !question.done);
}

function replies(worktree: Worktree, answered: Question[]): string {
	if (answered.length === 0) {
		return `${color.bold(worktree.task)} has no open questions`;
	}
	return [
		`${color.bold(worktree.task)} answered`,
		...answered.flatMap(formatQuestion),
	].join("\n");
}

function report(worktree: Worktree): string {
	const lines = [`${color.bold(worktree.task)} ${worktree.status}`];
	const escalation = worktree.state?.escalations?.at(-1)?.reason;
	if (escalation) {
		lines.push(`  ${color.yellow(`escalated: ${escalation}`)}`);
	}
	if (worktree.status === "removed") {
		lines.push(
			"",
			`Nothing left of it here: \`arbor log\` says whether it landed.`,
		);
	}
	return lines.join("\n");
}

import { color, type Logger } from "webappwiz/log";
import { Duration, sleep } from "webappwiz/time";
import { fail } from "./exit";
import type { Todos } from "./todos";
import type { Worktree, WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** How long `wait` gives a task before handing the wait back to its caller. */
export const DEFAULT_TIMEOUT = Duration.mins(15);

/** How often the task's record is re-read. Cheap: a file and two git refs. */
const POLL = Duration.secs(2);

/** The only two statuses a task moves on from by itself. */
const RUNNING: WorktreeStatus[] = ["working", "merging"];

export interface WaitOptions {
	/** How long to wait before giving up. */
	timeout?: Duration;
	/** How long between reads of the record; the default suits a human's patience. */
	poll?: Duration;
}

/**
 * Blocks until a task stops moving: merged or removed (both leave the name
 * `removed`), escalated to a human, or broken. Waiting is for the agent whose
 * own work overlaps this one's and would rather rebase onto the result than
 * against it, which is why the timeout is short enough to come back and think
 * again rather than block a session for an afternoon.
 */
export async function wait(
	{ service, log }: { service: WorktreeService; log: Logger },
	task: string,
	{ timeout = DEFAULT_TIMEOUT, poll = POLL }: WaitOptions = {},
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
		if (!RUNNING.includes(worktree.status)) {
			log.info(report(worktree));
			return;
		}
		const left = deadline - Date.now();
		if (left <= 0) {
			fail(
				"timeout",
				`'${task}' is still ${worktree.status} after ${timeout.secs}s: wait again, work alongside it and accept the rebase, or ask the human`,
				{ task, status: worktree.status },
			);
		}
		await sleep(Duration.min(poll, Duration.ms(left)));
	}
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

/**
 * Blocks until todo `id` leaves the list, which it does when the task that
 * took it merges (or it is removed): what an agent whose next todo comes
 * after it waits for, not knowing which task will take it. Ends early when
 * the task that has it is escalated, since that wait is on a person.
 */
export async function todoWait(
	{
		service,
		todos,
		log,
	}: { service: WorktreeService; todos: Todos; log: Logger },
	id: number,
	{ timeout = DEFAULT_TIMEOUT, poll = POLL }: WaitOptions = {},
): Promise<void> {
	// Refuses a todo there is no such thing as, which is a typo: one already
	// gone is a wait that is over before it began, and says so.
	await todos.find(id);
	const deadline = Date.now() + timeout.ms;
	for (;;) {
		const todo = (await todos.all()).find((each) => each.id === id);
		if (todo === undefined) {
			log.info(
				`${color.bold(`todo ${id}`)} landed or was removed: whatever came after it no longer waits on it`,
			);
			return;
		}
		const task =
			todo.takenBy === null ? null : await service.find(todo.takenBy);
		if (task?.status === "escalated") {
			log.info(
				[
					`${color.bold(`todo ${id}`)} is with ${task.task}, which is escalated`,
					`  ${color.yellow(`escalated: ${task.state?.escalations?.at(-1)?.reason ?? "no reason given"}`)}`,
					"",
					"It waits on a person: tell the user you are blocked on it.",
				].join("\n"),
			);
			return;
		}
		const left = deadline - Date.now();
		if (left <= 0) {
			fail(
				"timeout",
				`todo ${id} is still on the list after ${timeout.secs}s (${todo.takenBy === null ? "nobody has taken it" : `taken by ${todo.takenBy}`}): wait again, or ask the human`,
				{ todo: id, takenBy: todo.takenBy },
			);
		}
		await sleep(Duration.min(poll, Duration.ms(left)));
	}
}

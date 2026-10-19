import { color, type Logger } from "webappwiz/log";
import type { Fs } from "webappwiz/system";
import { Duration, sleep } from "webappwiz/time";
import type { Tasks } from "../board";
import { fail } from "../exit";
import { need } from "../plans";
import { TaskDetails } from "./show";
import type { Worktree, WorktreeStatus } from "./worktree";
import type { WorktreeService } from "./worktree-service";

/** How long `wait` gives a task before handing the wait back to its caller. */
export const DEFAULT_TIMEOUT = Duration.mins(15);

/** How often the task's record is re-read. Cheap: a file and two git refs. */
const POLL = Duration.secs(2);

/** The only two statuses a task moves on from by itself. */
const RUNNING: WorktreeStatus[] = ["working", "merging"];

/** When a wait begun now gives up after `timeout`, as an ISO time. */
export function untilAfter(timeout: Duration): string {
	return new Date(Date.now() + timeout.ms).toISOString();
}

export interface WaitOptions {
	/** How long to wait before giving up. */
	timeout?: Duration;
	/** How long between reads of the record; the default suits a human's patience. */
	poll?: Duration;
	/** The time a quiet agent is measured to, in milliseconds. */
	now?: () => number;
}

/**
 * Blocks until a task stops moving: merged or removed (both leave the name
 * `removed`), waiting on a person to answer its questions, or broken. Waiting is for the agent whose
 * own work overlaps this one's and would rather rebase onto the result than
 * against it, which is why the timeout is short enough to come back and think
 * again rather than block a session for an afternoon.
 */
export async function wait(
	{ service, log, fs }: { service: WorktreeService; log: Logger; fs?: Fs },
	task: string,
	{ timeout = DEFAULT_TIMEOUT, poll = POLL, now = Date.now }: WaitOptions = {},
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
				`no task '${task}': run \`splates list\` to see what there is`,
				{ task },
			);
		}
		if (!RUNNING.includes(worktree.status)) {
			log.info(report(worktree, null));
			return;
		}
		const asked = await asking(worktree, fs, now());
		if (asked !== null) {
			log.info(report(worktree, asked));
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

/**
 * The first open question `worktree`'s agent went quiet on, so it waits on a
 * person to answer it; null while it works, or asks nothing.
 */
async function asking(
	worktree: Worktree,
	fs: Fs | undefined,
	now: number,
): Promise<string | null> {
	const asked = need(
		await new TaskDetails(fs === undefined ? {} : { fs }).get(worktree),
		null,
		now,
	);
	return asked.kind === "waiting" ? asked.subject : null;
}

function report(worktree: Worktree, asked: string | null): string {
	const lines = [`${color.bold(worktree.task)} ${worktree.status}`];
	if (asked !== null) {
		lines.push(
			`  ${color.yellow(`asks: ${asked}`)}`,
			"",
			"It waits on a person: tell the user you are blocked on it.",
		);
	}
	if (worktree.status === "removed") {
		lines.push(
			"",
			`Nothing left of it here: \`splates log\` says whether it landed.`,
		);
	}
	return lines.join("\n");
}

/**
 * Blocks until queued task `id` leaves the list, which it does when the task that
 * took it merges (or it is removed): what an agent whose next task comes
 * after it waits for, not knowing which task will take it. Ends early when
 * the task that has it waits on a person to answer its questions.
 */
export async function taskWait(
	{
		service,
		tasks: queue,
		log,
		fs,
	}: { service: WorktreeService; tasks: Tasks; log: Logger; fs?: Fs },
	id: number,
	{ timeout = DEFAULT_TIMEOUT, poll = POLL, now = Date.now }: WaitOptions = {},
): Promise<void> {
	// Refuses a task there is no such thing as, which is a typo: one already
	// gone is a wait that is over before it began, and says so.
	await queue.find(id);
	const deadline = Date.now() + timeout.ms;
	for (;;) {
		const queued = (await queue.all()).find((each) => each.id === id);
		if (queued === undefined) {
			log.info(
				`${color.bold(`task ${id}`)} landed or was removed: whatever came after it no longer waits on it`,
			);
			return;
		}
		const task =
			queued.takenBy === null ? null : await service.find(queued.takenBy);
		const asked =
			task === null || !RUNNING.includes(task.status)
				? null
				: await asking(task, fs, now());
		if (task !== null && asked !== null) {
			log.info(
				[
					`${color.bold(`task ${id}`)} is with ${task.task}, which waits on a person`,
					`  ${color.yellow(`asks: ${asked}`)}`,
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
				`task ${id} is still on the list after ${timeout.secs}s (${queued.takenBy === null ? "nobody has taken it" : `taken by ${queued.takenBy}`}): wait again, or ask the human`,
				{ number: id, takenBy: queued.takenBy },
			);
		}
		await sleep(Duration.min(poll, Duration.ms(left)));
	}
}

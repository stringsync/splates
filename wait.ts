import { color, type Logger } from "webappwiz/log";
import { Duration, sleep } from "webappwiz/time";
import { fail } from "./exit";
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
				`no task '${task}': run \`arbor ls\` to see what there is`,
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

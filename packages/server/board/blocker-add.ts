import { color, type Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import { fail } from "../exit";
import type { Task } from "./task";
import { taskAdd } from "./task-edit";
import type { Tasks } from "./tasks";

/** What `splates blocker add` did. */
export interface BlockerAdded {
	/** The task now blocking, by number. */
	blocker: number;
	/** Its line. */
	subject: string;
	/** Whether a Backlog task was made for it. */
	created: boolean;
	/** The board task of the started work, now suspended. */
	suspended: Task;
}

/**
 * Makes `named`, a task number (`12` or `#12`) or else the subject of a new
 * Backlog task, a blocker of the board task that started task `task` took,
 * and suspends `conversation` until it merges. The worktree stays.
 */
export async function blockerAdd(
	deps: { tasks: Tasks; log: Logger; fs: Fs; ps: Ps },
	named: string,
	{
		task,
		conversation,
		scope,
		tags,
	}: {
		task: string | null;
		conversation?: string;
		scope?: string;
		tags?: string[];
	},
): Promise<BlockerAdded> {
	if (task === null) {
		fail(
			"usage",
			"run `splates blocker add` from the worktree of the task that is blocked",
			{},
		);
	}
	const [held] = await deps.tasks.takenBy(task);
	if (held === undefined) {
		fail(
			"usage",
			`'${task}' took no board task, so there is nothing to block: set it aside with \`splates remove ${task} --reason blocked\` instead`,
			{ task },
		);
	}
	const text = named.trim();
	const number = /^#?(\d+)$/.exec(text);
	let blocker: Task;
	let created = false;
	if (number !== null) {
		blocker = await deps.tasks.find(Number(number[1]));
	} else {
		blocker = await taskAdd(deps, text, task, {
			...(scope === undefined ? {} : { scope }),
			...(tags === undefined ? {} : { tags }),
		});
		created = true;
	}
	if (blocker.id === held.id) {
		fail("usage", "a task cannot block itself", { number: held.id });
	}
	const suspended = await held.suspend({
		blockedBy: [blocker.id],
		task,
		conversation,
	});
	deps.log.info(
		[
			`${color.green("blocked")} task ${held.id} by ${created ? "new " : ""}task ${blocker.id}: ${blocker.subject}`,
			"  the worktree stays; end your turn now, and the conversation wakes when every blocker has merged, or when the user writes to it",
			...(created
				? [
						`  end your reply with \`## 🔐 Permission: queue #${blocker.id}: ${blocker.subject}\` so the user can queue it`,
					]
				: []),
		].join("\n"),
	);
	return { blocker: blocker.id, subject: blocker.subject, created, suspended };
}

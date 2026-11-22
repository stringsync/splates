import { color, type Logger } from "core/log";
import type { Fs, Ps } from "core/system";
import { fail } from "../exit";
import type { ClosesOn, Task } from "./task";
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
	/** The board task of the started work, now linked to it. */
	blocked: Task;
}

/**
 * Makes `named`, a task number (`12` or `#12`) or else the subject of a new
 * Backlog task, a blocker of the board task that started task `task` took,
 * and has `conversation` told once the last blocker ends. The conversation
 * goes on, and the task's merge waits.
 */
export async function blockerAdd(
	deps: { tasks: Tasks; log: Logger; fs: Fs; ps: Ps },
	named: string,
	{
		task,
		conversation,
		scope,
		closesOn,
	}: {
		task: string | null;
		conversation?: string;
		scope?: string;
		/** The signal the new blocker closes on, for a subject: it ends when that is fired. */
		closesOn?: ClosesOn;
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
	if (closesOn !== undefined && number !== null) {
		fail(
			"usage",
			"--closes-on makes a new task: give a subject, or `splates task update <n> --closes-on` for one on the board",
			{ blocker: text },
		);
	}
	if (number !== null) {
		blocker = await deps.tasks.find(Number(number[1]));
	} else {
		blocker = await taskAdd(deps, text, task, {
			...(scope === undefined ? {} : { scope }),
			...(closesOn === undefined ? {} : { closesOn }),
		});
		created = true;
	}
	if (blocker.id === held.id) {
		fail("usage", "a task cannot block itself", { number: held.id });
	}
	const blocked = await held.block({
		blockedBy: [blocker.id],
		task,
		conversation,
	});
	deps.log.info(
		[
			`${color.green("blocked")} task ${held.id} by ${created ? "new " : ""}task ${blocker.id}: ${blocker.subject}`,
			"  `splates merge` refuses until every blocker has ended; work that does not need it can go on, and a notice comes here when the last one ends",
			...(created && closesOn === undefined
				? [
						`  end your reply with \`## 🔐 Permission: queue #${blocker.id}: ${blocker.subject}\` so the user can queue it`,
					]
				: []),
		].join("\n"),
	);
	return { blocker: blocker.id, subject: blocker.subject, created, blocked };
}

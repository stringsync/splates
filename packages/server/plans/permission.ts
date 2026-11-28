import type { TaskRecord } from "../board";

/** Whether the board has queued or started every task a queue card names. */
export function queueIsSettled(
	proposal: PermissionProposal,
	todos: readonly TaskRecord[],
): boolean {
	const { lane, tasks } = proposal;
	const mine =
		lane === null
			? tasks.flatMap((id) => todos.filter((todo) => todo.id === id))
			: todos.filter((todo) => todo.lane === lane);
	const byTask = lane === null || mine.length === 1;
	return mine
		.filter((todo) => todo.takenBy === null)
		.every(
			(todo) =>
				todo.stage === "queued" || (!byTask && todo.unqueuedFor !== undefined),
		);
}

/** Whether `line` titles a permission card. */
export function asksPermission(line: string): boolean {
	return [PERMISSION, RUN_PERMISSION].some((each) => each.test(line));
}

/** What the permission card titled `line`, with `body` under it, asks; null for any other line. */
export function permissionOf(
	line: string,
	body: string,
): PermissionProposal | null {
	const permission = PERMISSION.exec(line);
	const run = RUN_PERMISSION.exec(line);
	if (run !== null) {
		const rows = body.split("\n");
		const at = rows.findIndex((each) => RUN_COMMAND.test(each));
		const command =
			at < 0 ? "" : (RUN_COMMAND.exec(rows[at] as string)?.[1] as string);
		const reasons = rows.flatMap((each) => RUN_REASON.exec(each)?.[1] ?? []);
		return {
			action: "run-command",
			lane: null,
			tasks: [],
			title: run[1] || null,
			body: rows
				.filter((each, index) => index !== at && !RUN_REASON.test(each))
				.join("\n")
				.replace(/^\n+|\s+$/g, ""),
			command,
			// One reason line only: a second, however it reads, is no promise.
			...(reasons.length === 1
				? { reason: (reasons[0] as string).toLowerCase() }
				: {}),
		};
	}
	if (permission !== null) {
		const lane = permission[1] ?? permission[4];
		return {
			action: "queue",
			lane: lane === undefined ? null : Number(lane),
			tasks: Array.from(
				(permission[3] ?? permission[5] ?? "").matchAll(/\d+/g),
				Number,
			),
			...(permission[2] === undefined ? {} : { project: permission[2] }),
			title: permission[6] || null,
			body: body.replace(COMMAND_LINE, "").replace(/^\n+|\s+$/g, ""),
		};
	}
	return null;
}

/**
 * A permission card an agent's reply ends with, asking the person to allow
 * what an agent never does itself: queue a lane or tasks, run a heavy
 * command, or grant one project reach into another. The card's buttons
 * act on it.
 */
export interface PermissionProposal {
	/**
	 * What it asks: queue work, or run a heavy command, the whole test suite
	 * among them.
	 */
	action: "queue" | "run-command";
	/**
	 * For `queue`: the other project, by its slug, whose tasks it queues;
	 * absent for the conversation's own.
	 */
	project?: string;
	/** The lane it acts on whole; null for tasks named one by one. */
	lane: number | null;
	/** The tasks named one by one; none for a lane. */
	tasks: number[];
	/** What the title says after its colon, if anything. */
	title: string | null;
	/** What it comes to, as markdown. */
	body: string;
	/** For `run-command`: the command to run, from the first backticked line. */
	command?: string;
	/** For `run-command`: the card's `Reason:` word, `busy` only when the machine's load is the sole reason to ask, else `cost` or `risk`. */
	reason?: string;
}

const RUN_PERMISSION = /^## 🔐 Permission: run command(?::[ \t]*(.*?))?[ \t]*$/;
/** A run-command card's command: a line that is one code span. */
/** A run-command card's `Reason: busy` line: one word, on a line of its own. */
const RUN_REASON = /^Reason:[ \t]*([A-Za-z-]+)[ \t]*$/;
const RUN_COMMAND = /^`([^`\n]+)`[ \t]*$/;
// `## 🔐 Permission: queue lane <n>: <name>` or `queue #<n>, #<n>: <what>`
// (`queue <project> #<n>` for another project's tasks); the older
// `## 📥 Queue ...` titles read as the queue ones.
const PERMISSION =
	/^## (?:🔐 Permission: queue (?:lane (\d+)|(?:([\w.-]+) )?(#\d+(?:,[ \t]*#\d+)*))|📥 Queue (?:lane (\d+)|(#\d+(?:,[ \t]*#\d+)*)))(?::[ \t]*(.*?))?[ \t]*$/;
/**
 * A queue card's line of the command that queues its work from a terminal,
 * `` `splates lane queue 7` ``, which the card shows on its own row.
 */
const COMMAND_LINE = /^`splates [^`\n]+`[ \t]*$/gm;

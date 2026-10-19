import { color, type Logger } from "webappwiz/log";
import { fail } from "../exit";
import type { Task } from "./task";
import type { Tasks } from "./tasks";

/**
 * Takes up queued tasks for `task` after it started, as when one turns out to be
 * part of the work. Every id is checked before any is taken, so one that is
 * gone or another task's refuses them all.
 */
export async function taskTake(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	ids: number[],
	task: string | null,
): Promise<Task[]> {
	if (task === null) {
		fail(
			"usage",
			"take tasks from the worktree of the task they belong to, or start one with `splates add <slug> --task <id>`",
			{ tasks: ids },
		);
	}
	const found = await findAll(tasks, ids);
	for (const each of found) {
		if (each.takenBy !== null && each.takenBy !== task) {
			await each.take(task); // refuses, naming the task that has it
		}
	}
	const blocked = await Promise.all(
		found.map(async (each) =>
			blockedWarning(each, await each.blockers(task, ids)),
		),
	);
	const taken = await Promise.all(found.map((each) => each.take(task)));
	log.info(
		[
			...taken.map(
				(each) => `${color.green("took")} task ${each.id}: ${each.subject}`,
			),
			...blocked.flat(),
			`  add ${taken.length === 1 ? "it" : "them"} to the Goal in SPLATES.md; merging removes ${taken.length === 1 ? "it" : "them"}`,
		].join("\n"),
	);
	return taken;
}

/**
 * Puts tasks back in the queue, as when a task is landing without finishing
 * them: say what is left with `splates task update` first. From a worktree it
 * gives back only the tasks it took.
 */
export async function taskRelease(
	{ tasks, log }: { tasks: Tasks; log: Logger },
	ids: number[],
	task: string | null,
): Promise<Task[]> {
	const found = await findAll(tasks, ids);
	const other = found.find(
		(each) => task !== null && each.takenBy !== null && each.takenBy !== task,
	);
	if (other) {
		fail(
			"exists",
			`task ${other.id} is taken by '${other.takenBy}', not '${task}': nothing was released`,
			{ number: other.id, takenBy: other.takenBy },
		);
	}
	const released = await Promise.all(found.map((each) => each.release()));
	log.info(
		released
			.map(
				(each) => `${color.green("released")} task ${each.id}: ${each.subject}`,
			)
			.join("\n"),
	);
	return released;
}

/**
 * The lines warning that `taken` was taken while `blockers` have yet to merge,
 * or none when nothing blocks it: it may be started, but what it builds on
 * is not there yet.
 */
export function blockedWarning(taken: Task, blockers: Task[]): string[] {
	const [first] = blockers;
	if (first === undefined) {
		return [];
	}
	const where = (other: Task) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? "open" : `taken by ${other.takenBy}`,
		]
			.filter(Boolean)
			.join(", ");
	return [
		`  ${color.yellow("blocked")}: task ${taken.id} is blocked by ${blockers.map((other) => `task ${other.id} (${where(other)})`).join(" and ")}, which ${blockers.length === 1 ? "has" : "have"} yet to merge`,
		`  work only on what does not need ${blockers.length === 1 ? "it" : "them"}, or \`splates task wait ${first.id}\` until it lands`,
	];
}

/** Every task in `ids`, once each, refusing the lot if one is missing. */
async function findAll(tasks: Tasks, ids: number[]): Promise<Task[]> {
	if (ids.length === 0) {
		fail("usage", "name at least one task number: run `splates task list`", {});
	}
	return Promise.all([...new Set(ids)].map((id) => tasks.find(id)));
}

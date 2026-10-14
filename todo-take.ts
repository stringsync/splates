import { color, type Logger } from "webappwiz/log";
import { fail } from "./exit";
import type { Todo } from "./todo";
import type { Todos } from "./todos";

/**
 * Takes up todos for `task` after it started, as when one turns out to be
 * part of the work. Every id is checked before any is taken, so one that is
 * gone or another task's refuses them all.
 */
export async function todoTake(
	{ todos, log }: { todos: Todos; log: Logger },
	ids: number[],
	task: string | null,
): Promise<Todo[]> {
	if (task === null) {
		fail(
			"usage",
			"take todos from the worktree of the task they belong to, or start one with `arbor add <task> --todo <id>`",
			{ todos: ids },
		);
	}
	const found = await findAll(todos, ids);
	for (const todo of found) {
		if (todo.takenBy !== null && todo.takenBy !== task) {
			await todo.take(task); // refuses, naming the task that has it
		}
	}
	const blocked = await Promise.all(
		found.map(async (todo) =>
			blockedWarning(todo, await todo.blockers(task, ids)),
		),
	);
	const taken = await Promise.all(found.map((todo) => todo.take(task)));
	log.info(
		[
			...taken.map(
				(todo) => `${color.green("took")} todo ${todo.id}: ${todo.subject}`,
			),
			...blocked.flat(),
			`  add ${taken.length === 1 ? "it" : "them"} to the Goal in ARBOR.md; merging removes ${taken.length === 1 ? "it" : "them"}`,
		].join("\n"),
	);
	return taken;
}

/**
 * Puts todos back on the list, as when a task is landing without finishing
 * them: say what is left with `arbor todo update` first. From a worktree it
 * gives back only its own task's todos.
 */
export async function todoRelease(
	{ todos, log }: { todos: Todos; log: Logger },
	ids: number[],
	task: string | null,
): Promise<Todo[]> {
	const found = await findAll(todos, ids);
	const other = found.find(
		(todo) => task !== null && todo.takenBy !== null && todo.takenBy !== task,
	);
	if (other) {
		fail(
			"exists",
			`todo ${other.id} is taken by '${other.takenBy}', not '${task}': nothing was released`,
			{ todo: other.id, takenBy: other.takenBy },
		);
	}
	const released = await Promise.all(found.map((todo) => todo.release()));
	log.info(
		released
			.map(
				(todo) => `${color.green("released")} todo ${todo.id}: ${todo.subject}`,
			)
			.join("\n"),
	);
	return released;
}

/**
 * The lines warning that `todo` was taken while `blockers` have yet to merge,
 * or none when nothing blocks it: it may be started, but what it builds on
 * is not there yet.
 */
export function blockedWarning(todo: Todo, blockers: Todo[]): string[] {
	const [first] = blockers;
	if (first === undefined) {
		return [];
	}
	const where = (other: Todo) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? "open" : `taken by ${other.takenBy}`,
		]
			.filter(Boolean)
			.join(", ");
	return [
		`  ${color.yellow("blocked")}: todo ${todo.id} is blocked by ${blockers.map((other) => `todo ${other.id} (${where(other)})`).join(" and ")}, which ${blockers.length === 1 ? "has" : "have"} yet to merge`,
		`  work only on what does not need ${blockers.length === 1 ? "it" : "them"}, or \`arbor todo wait ${first.id}\` until it lands`,
	];
}

/** Every todo in `ids`, once each, refusing the lot if one is missing. */
async function findAll(todos: Todos, ids: number[]): Promise<Todo[]> {
	if (ids.length === 0) {
		fail("usage", "name at least one todo id: run `arbor todo list`", {});
	}
	return Promise.all([...new Set(ids)].map((id) => todos.find(id)));
}

import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { readFiles } from "./attachments";
import { fail } from "./exit";
import type { AgentPick } from "./roster";
import type { Todo } from "./todo";
import type { Todos } from "./todos";

export interface TodoFileOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
}

export interface TodoAddOptions extends TodoFileOptions {
	/** Whatever more there is to say than the subject. */
	text?: string;
	/** Where it goes in the list, 1 at the top; the bottom by default. */
	position?: number;
	/** The todos blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
	/** The agent that should work it; none by default. */
	assignee?: AgentPick | null;
}

export async function todoAdd(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{
		text,
		files = [],
		position,
		blockedBy,
		lane,
		assignee,
	}: TodoAddOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.add(subject, from, {
		text,
		files: await readFiles(deps, files),
		position,
		blockedBy,
		lane,
		assignee,
	});
	deps.log.info(
		[
			`${color.green("added")} todo ${todo.id} at position ${todo.position}${todo.lane === null ? "" : ` in lane ${todo.lane}`}`,
			...todo.files.map((path) => `  ${path}`),
			todo.blockedBy.length === 0
				? `  start it: arbor add <task> --todo ${todo.id}`
				: `  blocked by: ${todo.blockedBy.map((id) => `todo ${id}`).join(", ")}, which merge first`,
		].join("\n"),
	);
	return todo;
}

export interface TodoUpdateOptions extends TodoFileOptions {
	/** A new line; the old one stays when this is absent or empty. */
	subject?: string;
	/** New detail; the old stays when this is absent or empty. */
	text?: string;
	/** Where to move it in the list, 1 at the top; it stays put when absent. */
	position?: number;
	/** Attached files to drop, by path or by the name they were stored under. */
	removeFiles?: string[];
	/** Todos blocking it from now on, besides those that already do. */
	blockedBy?: number[];
	/** Todos no longer blocking it. */
	removeBlockedBy?: number[];
	/** The lane it moves to, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
	/** The agent that should work it, null for none; it stays when absent. */
	assignee?: AgentPick | null;
}

export async function todoUpdate(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	id: number,
	{
		subject,
		text,
		position,
		files = [],
		removeFiles = [],
		blockedBy = [],
		removeBlockedBy = [],
		lane,
		assignee,
	}: TodoUpdateOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.find(id);
	const unlinked = removeBlockedBy.find(
		(each) => !todo.blockedBy.includes(each),
	);
	if (unlinked !== undefined) {
		fail(
			"not_found",
			`todo ${id} is not blocked by todo ${unlinked}: nothing was changed`,
			{ todo: id, blockedBy: unlinked },
		);
	}
	const matches = (path: string, named: string) =>
		path === named || basename(path) === named;
	const unknown = removeFiles.find(
		(named) => !todo.files.some((path) => matches(path, named)),
	);
	if (unknown !== undefined) {
		fail(
			"not_found",
			`todo ${id} has no file '${unknown}': nothing was changed`,
			{ todo: id, file: unknown },
		);
	}
	const dropped = todo.files.filter((path) =>
		removeFiles.some((named) => matches(path, named)),
	);
	const updated = await todo.update({
		subject: subject || undefined,
		text: text || undefined,
		position,
		files: await readFiles(deps, files),
		keep: todo.files.filter((path) => !dropped.includes(path)),
		blockedBy:
			blockedBy.length === 0 && removeBlockedBy.length === 0
				? undefined
				: [...todo.blockedBy, ...blockedBy].filter(
						(each) => !removeBlockedBy.includes(each),
					),
		lane,
		assignee,
	});
	deps.log.info(
		[
			`${color.green("updated")} todo ${id} at position ${updated.position}${updated.lane === null ? "" : ` in lane ${updated.lane}`}: ${updated.subject}`,
			...updated.files.map((path) => `  ${path}`),
			...(updated.blockedBy.length === 0
				? []
				: [
						`  blocked by: ${updated.blockedBy.map((each) => `todo ${each}`).join(", ")}`,
					]),
		].join("\n"),
	);
	return updated;
}

export async function todoRemove(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
): Promise<void> {
	const todo = await todos.find(id);
	await todo.remove();
	log.info(`${color.green("removed")} todo ${id}: ${todo.subject}`);
}

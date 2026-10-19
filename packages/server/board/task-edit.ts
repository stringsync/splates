import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { readFiles } from "../artifacts";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Facts } from "../records";
import type { Task, TaskOrigin } from "./task";
import type { Tasks } from "./tasks";

export interface TaskFileOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
}

export interface TaskAddOptions extends TaskFileOptions {
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
	/** The other project it is added from; none by default. */
	origin?: TaskOrigin;
}

export async function taskAdd(
	deps: { todos: Tasks; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{
		text,
		files = [],
		position,
		blockedBy,
		lane,
		assignee,
		origin,
	}: TaskAddOptions = {},
): Promise<Task> {
	const todo = await deps.todos.add(subject, from, {
		text,
		files: await readFiles(deps, files),
		position,
		blockedBy,
		lane,
		assignee,
		origin,
	});
	deps.log.info(
		[
			`${color.green("added")} todo ${todo.id} at position ${todo.position}${todo.lane === null ? "" : ` in lane ${todo.lane}`}`,
			...todo.files.map((path) => `  ${path}`),
			todo.blockedBy.length === 0
				? `  start it: splates add <task> --todo ${todo.id}`
				: `  blocked by: ${todo.blockedBy.map((id) => `todo ${id}`).join(", ")}, which merge first`,
		].join("\n"),
	);
	return todo;
}

/** What a `todo add` event says of the todo it added. */
export function addedFacts(todo: Task): Facts["todo add"] {
	return {
		todo: todo.id,
		subject: todo.subject,
		lane: todo.lane,
		position: todo.position,
	};
}

export interface TaskUpdateOptions extends TaskFileOptions {
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

export async function taskUpdate(
	deps: { todos: Tasks; log: Logger; fs: Fs; ps: Ps },
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
	}: TaskUpdateOptions = {},
): Promise<Task> {
	const todo = await deps.todos.find(id);
	// A blocker removed without merging is let go of as one still linked is.
	const lost = removeBlockedBy.filter((each) =>
		todo.state.blockersLost?.some((gone) => gone.id === each),
	);
	const unlinked = removeBlockedBy.find(
		(each) => !todo.blockedBy.includes(each) && !lost.includes(each),
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
	if (lost.length > 0) {
		await deps.todos.link(id, { drop: lost });
	}
	const updated = await todo.update({
		subject: subject || undefined,
		text: text || undefined,
		position,
		files: await readFiles(deps, files),
		keep: todo.files.filter((path) => !dropped.includes(path)),
		blockedBy:
			blockedBy.length === 0 &&
			removeBlockedBy.every((each) => lost.includes(each))
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

export async function taskRemove(
	{ todos, log }: { todos: Tasks; log: Logger },
	id: number,
): Promise<Task> {
	const todo = await todos.find(id);
	await todo.remove();
	log.info(`${color.green("removed")} todo ${id}: ${todo.subject}`);
	return todo;
}

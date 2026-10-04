import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { age } from "./age";
import { type Attachment, type Attachments, readFiles } from "./attachments";
import { fail } from "./exit";
import { table } from "./table";
import type { Todos } from "./todos";

/** What a todo is on disk: one file apiece, so two agents never rewrite one. */
export interface TodoState {
	id: number;
	/** What is left to do, in a line. */
	subject: string;
	/** Whatever more there is to say about it, or empty when the line is enough. */
	text: string;
	/** Where it stands in the list, 1 at the top: the one to pick up first. */
	position: number;
	/** The task it came up in, or null when a person added it from the main tree. */
	from: string | null;
	createdAt: string;
	/** The task working on it now, or null while it waits to be picked up. */
	takenBy: string | null;
	/** Absolute paths of the files attached, in `todos/<id>/`. */
	files: string[];
	/** What it belongs to, sorted: the areas or goals it adds up to with others. */
	tags: string[];
}

/**
 * Work deferred for later: what an agent notes when something outside its
 * task comes up, so it can move on instead of growing the task. Kept under the
 * shared `.git`, so every worktree sees a new one at once, with nothing to
 * commit and nothing to merge.
 */
export class Todo {
	constructor(
		private readonly todos: Todos,
		readonly state: TodoState,
	) {}

	get id(): number {
		return this.state.id;
	}

	get subject(): string {
		return this.state.subject;
	}

	get text(): string {
		return this.state.text;
	}

	get position(): number {
		return this.state.position;
	}

	get from(): string | null {
		return this.state.from;
	}

	get takenBy(): string | null {
		return this.state.takenBy;
	}

	get createdAt(): Date {
		return new Date(this.state.createdAt);
	}

	/** How long it has waited, in milliseconds. */
	get waited(): number {
		return Date.now() - this.createdAt.getTime();
	}

	/** Marks it as the work of `task`, refusing one another task already has. */
	take(task: string): Promise<Todo> {
		return this.todos.revise(this.id, (state) => {
			if (state.takenBy !== null && state.takenBy !== task) {
				fail(
					"exists",
					`todo ${this.id} is already taken by '${state.takenBy}': pick another from \`arbor todo list\``,
					{ todo: this.id, takenBy: state.takenBy },
				);
			}
			return { ...state, takenBy: task };
		});
	}

	/** Puts it back on the list, as when the task that took it is removed. */
	release(): Promise<Todo> {
		return this.todos.revise(this.id, (state) => ({
			...state,
			takenBy: null,
		}));
	}

	get files(): string[] {
		return this.state.files;
	}

	get tags(): string[] {
		return this.state.tags;
	}

	get attachments(): Attachments {
		return this.todos.attachments(this.id);
	}

	/**
	 * Says what is left to do in other words, with other files, or higher or
	 * lower in the list, keeping its id and history.
	 */
	async update({
		subject,
		text,
		position,
		files = [],
		keep,
		tags,
	}: TodoChange): Promise<Todo> {
		const words = wording(subject ?? this.subject, text ?? this.text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {
				todo: this.id,
			});
		}
		const tagged = tags === undefined ? this.tags : tagList(tags);
		const kept =
			keep === undefined
				? this.files
				: this.files.filter((path) => keep.includes(path));
		await this.attachments.remove(
			this.files.filter((path) => !kept.includes(path)),
		);
		const added = await this.attachments.store(files);
		const updated = await this.todos.revise(this.id, (state) => ({
			...state,
			...words,
			files: [...kept, ...added],
			tags: tagged,
		}));
		return position === undefined
			? updated
			: this.todos.move(this.id, position);
	}

	async remove(): Promise<void> {
		await this.todos.delete(this.id);
		await this.attachments.clear();
	}
}

/** A tag in use, with how many todos have it. */
export interface TagState {
	tag: string;
	todos: number;
}

/** A lowercase word or a few joined by hyphens, so `Dark Mode` and `dark-mode` cannot both exist. */
const TAG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `tags` deduped and sorted, refusing any not written the one way. */
export function tagList(tags: string[]): string[] {
	const bad = tags.find((tag) => !TAG.test(tag));
	if (bad !== undefined) {
		fail(
			"usage",
			`'${bad}' is not a tag: use one lowercase word, or a few joined by hyphens, like uploads or dark-mode`,
			{ tag: bad },
		);
	}
	return [...new Set(tags)].sort();
}

/** A todo's words, place or files changed: new ones added, some of the old kept. */
export interface TodoChange {
	/** A new line; the old one stays when this is absent. */
	subject?: string;
	/** New detail, empty for none; the old stays when this is absent. */
	text?: string;
	/** Where to move it in the list; it stays put when this is absent. */
	position?: number;
	/** Files to add. */
	files?: Attachment[];
	/** The paths of the files it has now to keep; absent keeps them all. */
	keep?: string[];
	/** Its tags from now on; the old stay when this is absent. */
	tags?: string[];
}

/** What a new todo has besides its subject, all of it optional. */
export interface TodoNew {
	/** Whatever more there is to say about it. */
	text?: string;
	files?: Attachment[];
	/** Where it goes in the list, pushing those from there down; the bottom by default. */
	position?: number;
	tags?: string[];
}

/**
 * A subject and its detail, trimmed. A subject running past one line keeps
 * only the first, the rest leading the detail, so the list stays one line a
 * todo however it was written.
 */
export function wording(
	subject: string,
	text: string,
): { subject: string; text: string } {
	const [first = "", ...rest] = subject.trim().split("\n");
	return {
		subject: first.trim(),
		text: [rest.join("\n").trim(), text.trim()].filter(Boolean).join("\n\n"),
	};
}

/** What a finished task should be followed by, and what should just go. */
export interface Recommendation {
	/** The todo to pick up next, or null when there is nothing fresh left. */
	next: Todo | null;
	/** Todos left waiting so long they probably no longer apply. */
	stale: Todo[];
}

/**
 * Which todo to take up after `task`: one that came up in it first, since
 * whoever just finished it knows that context best, then one sharing a tag
 * in `settled`, those of the todos it finished, the same area of work, then the open one highest
 * on the list, which is how whoever keeps the list says what matters most.
 * Todos past `staleness` are never recommended, only offered for removal.
 */
export async function recommend(
	todos: Todos,
	task: string | null,
	staleness: number,
	settled: string[] = [],
): Promise<Recommendation> {
	const rank = (todo: Todo) =>
		todo.from === task
			? 2
			: todo.tags.some((tag) => settled.includes(tag))
				? 1
				: 0;
	const open = (await todos.all())
		.filter((todo) => todo.takenBy === null)
		// Stable, so each group keeps its place in the list.
		.sort((left, right) => rank(right) - rank(left));
	return {
		next: open.find((todo) => todo.waited <= staleness) ?? null,
		stale: open.filter((todo) => todo.waited > staleness),
	};
}

/** The lines `merge` ends with, or none when there is nothing to say. */
export function recommendation({ next, stale }: Recommendation): string[] {
	const lines: string[] = [];
	if (next) {
		lines.push(
			"",
			`${color.bold("next todo")} ${next.id}: ${next.subject}`,
			`  ${from(next)}, waiting ${age(next.state.createdAt)}`,
			`  start it: arbor add <task> --todo ${next.id}`,
		);
	}
	if (stale.length > 0) {
		lines.push(
			"",
			color.yellow("stale todos, remove unless they still apply:"),
		);
		for (const todo of stale) {
			lines.push(
				`  ${todo.id}: ${todo.subject} (${age(todo.state.createdAt)})  arbor todo remove ${todo.id}`,
			);
		}
	}
	return lines;
}

function from(todo: Todo): string {
	return todo.from === null ? "added by hand" : `from ${todo.from}`;
}

export interface TodoListOptions {
	/** Print the todos as JSON instead of a table. */
	json?: boolean;
	/** Only those no task has taken: the ones free to pick up. */
	open?: boolean;
	/** Only those with any of these tags; every todo when empty. */
	tags?: string[];
}

export interface TodoFileOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
}

export interface TodoAddOptions extends TodoFileOptions {
	/** Whatever more there is to say than the subject. */
	text?: string;
	/** Where it goes in the list, 1 at the top; the bottom by default. */
	position?: number;
	tags?: string[];
}

export async function todoAdd(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{ text, files = [], position, tags }: TodoAddOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.add(subject, from, {
		text,
		files: await readFiles(deps, files),
		position,
		tags,
	});
	deps.log.info(
		[
			`${color.green("added")} todo ${todo.id} at position ${todo.position}`,
			...todo.files.map((path) => `  ${path}`),
			`  start it: arbor add <task> --todo ${todo.id}`,
		].join("\n"),
	);
	return todo;
}

export async function todoList(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false, open = false, tags = [] }: TodoListOptions = {},
): Promise<void> {
	const every = await todos.all();
	const listed = every.filter(
		(todo) =>
			(!open || todo.takenBy === null) &&
			(tags.length === 0 || todo.tags.some((tag) => tags.includes(tag))),
	);
	if (json) {
		log.info(
			JSON.stringify(
				listed.map((todo) => todo.state),
				null,
				"\t",
			),
		);
		return;
	}
	if (every.length === 0) {
		log.info("no todos: `arbor todo add <subject>` defers work for later");
		return;
	}
	if (listed.length === 0) {
		log.info(
			tags.length === 0
				? "no open todos: every one is taken, see `arbor todo list`"
				: `no ${open ? "open " : ""}todos tagged ${tags.join(" or ")}: see \`arbor todo tags\``,
		);
		return;
	}
	log.info(
		table(
			["POS", "ID", "SUBJECT", "TAGS", "FROM", "AGE", "TAKEN BY", "FILES"],
			listed.map((todo) => [
				String(todo.position),
				String(todo.id),
				todo.subject,
				todo.tags.join(","),
				todo.from ?? "",
				age(todo.state.createdAt),
				todo.takenBy ?? "",
				todo.files.length === 0 ? "" : String(todo.files.length),
			]),
		),
	);
}

export interface TodoShowOptions {
	/** Print the todo as JSON instead of prose. */
	json?: boolean;
}

/** One todo in full: what `todo list` shows of it, its files, and its detail. */
export async function todoShow(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
	{ json = false }: TodoShowOptions = {},
): Promise<void> {
	const todo = await todos.find(id);
	if (json) {
		log.info(JSON.stringify(todo.state, null, "\t"));
		return;
	}
	const lines = [
		`${color.bold(`todo ${todo.id}`)} ${todo.subject}`,
		`  position:  ${todo.position}`,
		`  from:      ${todo.from ?? "added by hand"}`,
		`  taken by:  ${todo.takenBy ?? "nobody yet"}`,
		...(todo.tags.length === 0 ? [] : [`  tags:      ${todo.tags.join(", ")}`]),
		`  age:       ${age(todo.state.createdAt)}`,
		...todo.files.map((path) => `  file:      ${path}`),
	];
	if (todo.text !== "") {
		lines.push("", todo.text);
	}
	log.info(lines.join("\n"));
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
	/** Tags to add. */
	tags?: string[];
	/** Tags to drop. */
	removeTags?: string[];
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
		tags = [],
		removeTags = [],
	}: TodoUpdateOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.find(id);
	const unknownTag = removeTags.find((tag) => !todo.tags.includes(tag));
	if (unknownTag !== undefined) {
		fail(
			"not_found",
			`todo ${id} has no tag '${unknownTag}': nothing was changed`,
			{ todo: id, tag: unknownTag },
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
		tags: [...todo.tags, ...tags].filter((tag) => !removeTags.includes(tag)),
	});
	deps.log.info(
		[
			`${color.green("updated")} todo ${id} at position ${updated.position}: ${updated.subject}`,
			...updated.files.map((path) => `  ${path}`),
		].join("\n"),
	);
	return updated;
}

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
	const taken = await Promise.all(found.map((todo) => todo.take(task)));
	log.info(
		[
			...taken.map(
				(todo) => `${color.green("took")} todo ${todo.id}: ${todo.subject}`,
			),
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

/** Every todo in `ids`, once each, refusing the lot if one is missing. */
async function findAll(todos: Todos, ids: number[]): Promise<Todo[]> {
	if (ids.length === 0) {
		fail("usage", "name at least one todo id: run `arbor todo list`", {});
	}
	return Promise.all([...new Set(ids)].map((id) => todos.find(id)));
}

export async function todoRemove(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
): Promise<void> {
	const todo = await todos.find(id);
	await todo.remove();
	log.info(`${color.green("removed")} todo ${id}: ${todo.subject}`);
}

export interface TodoTagsOptions {
	/** Print the tags as JSON instead of a table. */
	json?: boolean;
}

/** Every tag in use, with how many todos have it: the names to reuse first. */
export async function todoTags(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false }: TodoTagsOptions = {},
): Promise<void> {
	const tags = await todos.tags();
	if (json) {
		log.info(JSON.stringify(tags, null, "\t"));
		return;
	}
	if (tags.length === 0) {
		log.info("no tags: `arbor todo add <subject> --tag <tag>` adds one");
		return;
	}
	log.info(
		table(
			["TAG", "TODOS"],
			tags.map(({ tag, todos }) => [tag, String(todos)]),
		),
	);
}

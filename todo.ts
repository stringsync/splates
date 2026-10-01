import { basename } from "node:path";
import { type IdProvider, UuidProvider } from "webappwiz/id";
import { color, type Logger } from "webappwiz/log";
import { type Fs, type Lock, NodeFs, type Ps } from "webappwiz/system";
import { age } from "./age";
import { type Attachment, Attachments, readFiles } from "./attachments";
import { fail } from "./exit";
import { table } from "./table";

/** What a todo is on disk: one file apiece, so two agents never rewrite one. */
export interface TodoState {
	id: number;
	text: string;
	/** The task it came up in, or null when a person added it from the main tree. */
	from: string | null;
	createdAt: string;
	/** The task working on it now, or null while it waits to be picked up. */
	takenBy: string | null;
	/** Absolute paths of the files attached, in `todos/<id>/`. */
	files: string[];
}

/** A todo's words and files changed: new ones added, some of the old kept. */
export interface TodoChange {
	/** New words; the old ones stay when this is absent. */
	text?: string;
	/** Files to add. */
	files?: Attachment[];
	/** The paths of the files it has now to keep; absent keeps them all. */
	keep?: string[];
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

	get text(): string {
		return this.state.text;
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
	async take(task: string): Promise<Todo> {
		if (this.takenBy !== null && this.takenBy !== task) {
			fail(
				"exists",
				`todo ${this.id} is already taken by '${this.takenBy}': pick another from \`arbor todo list\``,
				{ todo: this.id, takenBy: this.takenBy },
			);
		}
		return this.todos.save({ ...this.state, takenBy: task });
	}

	/** Puts it back on the list, as when the task that took it is removed. */
	release(): Promise<Todo> {
		return this.todos.save({ ...this.state, takenBy: null });
	}

	get files(): string[] {
		return this.state.files;
	}

	get attachments(): Attachments {
		return this.todos.attachments(this.id);
	}

	/**
	 * Says what is left to do in other words, or with other files, keeping its
	 * id and history.
	 */
	async update({ text, files = [], keep }: TodoChange): Promise<Todo> {
		const trimmed = text?.trim() ?? this.text;
		if (trimmed === "") {
			fail("usage", "a todo needs text: say what is left to do", {
				todo: this.id,
			});
		}
		const kept =
			keep === undefined
				? this.files
				: this.files.filter((path) => keep.includes(path));
		await this.attachments.remove(
			this.files.filter((path) => !kept.includes(path)),
		);
		const added = await this.attachments.store(files);
		return this.todos.save({
			...this.state,
			text: trimmed,
			files: [...kept, ...added],
		});
	}

	async remove(): Promise<void> {
		await this.todos.delete(this.id);
		await this.attachments.clear();
	}
}

/** What `Todos` is stored through; the real filesystem by default. */
export interface TodosOptions {
	fs?: Fs;
	/** Names stored files apart; a test counts. */
	ids?: IdProvider;
}

/** Every todo in the repo, one JSON file each under `.git/arbor/todos`. */
export class Todos {
	private readonly fs: Fs;
	private readonly ids: IdProvider;

	constructor(
		readonly dir: string,
		/** Held while numbering a new todo, so two agents never share an id. */
		private readonly lock: Lock,
		opts: TodosOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
		this.ids = opts.ids ?? new UuidProvider();
	}

	/** Where a todo's files live, beside its record. */
	attachments(id: number): Attachments {
		return new Attachments(`${this.dir}/${id}`, this.fs, this.ids);
	}

	/** Whether `path` is a file some todo holds, and not a way out of here. */
	owns(path: string): boolean {
		return new Attachments(this.dir, this.fs).owns(path);
	}

	async add(
		text: string,
		from: string | null,
		files: Attachment[] = [],
	): Promise<Todo> {
		const trimmed = text.trim();
		if (trimmed === "") {
			fail("usage", "a todo needs text: say what is left to do", {});
		}
		await this.fs.mkdir(this.dir);
		await this.lock.acquire();
		try {
			// Numbered past every id handed out before, removed ones included, so
			// a number never comes back meaning something else.
			const id = (await this.lastId()) + 1;
			await this.fs.write(`${this.dir}/last`, String(id));
			return await this.save({
				id,
				text: trimmed,
				from,
				createdAt: new Date().toISOString(),
				takenBy: null,
				files: await this.attachments(id).store(files),
			});
		} finally {
			await this.lock.release();
		}
	}

	/** Oldest first. A file that will not parse is skipped rather than fatal. */
	async all(): Promise<Todo[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
		const todos: Todo[] = [];
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const state = await this.read(`${this.dir}/${entry}`);
			if (state) {
				todos.push(new Todo(this, state));
			}
		}
		return todos.sort((left, right) => left.id - right.id);
	}

	async find(id: number): Promise<Todo> {
		const state = await this.read(this.path(id));
		if (!state) {
			fail("not_found", `no todo ${id}: run \`arbor todo list\``, {
				todo: id,
			});
		}
		return new Todo(this, state);
	}

	/** The todos `task` has taken; what a merge or remove settles. */
	async takenBy(task: string): Promise<Todo[]> {
		return (await this.all()).filter((todo) => todo.takenBy === task);
	}

	/** @internal Writes one todo. Rename makes the swap atomic for readers. */
	async save(state: TodoState): Promise<Todo> {
		const path = this.path(state.id);
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
		return new Todo(this, state);
	}

	/** @internal */
	async delete(id: number): Promise<void> {
		await this.fs.rm(this.path(id), { force: true });
	}

	private path(id: number): string {
		return `${this.dir}/${id}.json`;
	}

	private async lastId(): Promise<number> {
		const last = Number(await this.fs.read(`${this.dir}/last`).catch(() => 0));
		const ids = (await this.all()).map((todo) => todo.id);
		return Math.max(Number.isInteger(last) ? last : 0, ...ids);
	}

	private async read(path: string): Promise<TodoState | null> {
		const raw = await this.fs.read(path).catch(() => null);
		if (raw === null) {
			return null;
		}
		try {
			// One saved before todos took files has none, rather than no list.
			const state = JSON.parse(raw) as Omit<TodoState, "files"> & {
				files?: string[];
			};
			return { ...state, files: state.files ?? [] };
		} catch {
			return null;
		}
	}
}

/** What a finished task should be followed by, and what should just go. */
export interface Recommendation {
	/** The todo to pick up next, or null when there is nothing fresh left. */
	next: Todo | null;
	/** Todos left waiting so long they probably no longer apply. */
	stale: Todo[];
}

/**
 * Which todo to take up after `task`: its own first, since whoever just
 * finished it knows that context best, then the longest waiting. Todos past
 * `staleness` are never recommended, only offered for removal.
 */
export async function recommend(
	todos: Todos,
	task: string | null,
	staleness: number,
): Promise<Recommendation> {
	const open = (await todos.all())
		.filter((todo) => todo.takenBy === null)
		.sort(
			(left, right) =>
				Number(right.from === task) - Number(left.from === task) ||
				left.createdAt.getTime() - right.createdAt.getTime(),
		);
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
			`${color.bold("next todo")} ${next.id}: ${next.text}`,
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
				`  ${todo.id}: ${todo.text} (${age(todo.state.createdAt)})  arbor todo remove ${todo.id}`,
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
}

export interface TodoFileOptions {
	/** Files to attach, relative to the current directory or absolute. */
	files?: string[];
}

export async function todoAdd(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	text: string,
	from: string | null,
	{ files = [] }: TodoFileOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.add(text, from, await readFiles(deps, files));
	deps.log.info(
		[
			`${color.green("added")} todo ${todo.id}`,
			...todo.files.map((path) => `  ${path}`),
			`  start it: arbor add <task> --todo ${todo.id}`,
		].join("\n"),
	);
	return todo;
}

export async function todoList(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false }: TodoListOptions = {},
): Promise<void> {
	const all = await todos.all();
	if (json) {
		log.info(
			JSON.stringify(
				all.map((todo) => todo.state),
				null,
				"\t",
			),
		);
		return;
	}
	if (all.length === 0) {
		log.info("no todos: `arbor todo add <text>` defers work for later");
		return;
	}
	log.info(
		table(
			["ID", "TODO", "FROM", "AGE", "TAKEN BY", "FILES"],
			all.map((todo) => [
				String(todo.id),
				todo.text,
				todo.from ?? "",
				age(todo.state.createdAt),
				todo.takenBy ?? "",
				todo.files.length === 0 ? "" : String(todo.files.length),
			]),
		),
	);
}

export interface TodoUpdateOptions extends TodoFileOptions {
	/** New words; the old ones stay when this is absent or empty. */
	text?: string;
	/** Attached files to drop, by path or by the name they were stored under. */
	removeFiles?: string[];
}

export async function todoUpdate(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	id: number,
	{ text, files = [], removeFiles = [] }: TodoUpdateOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.find(id);
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
		text: text || undefined,
		files: await readFiles(deps, files),
		keep: todo.files.filter((path) => !dropped.includes(path)),
	});
	deps.log.info(
		[
			`${color.green("updated")} todo ${id}: ${updated.text}`,
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
				(todo) => `${color.green("took")} todo ${todo.id}: ${todo.text}`,
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
			.map((todo) => `${color.green("released")} todo ${todo.id}: ${todo.text}`)
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
	log.info(`${color.green("removed")} todo ${id}: ${todo.text}`);
}

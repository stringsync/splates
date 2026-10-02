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
}

/** What a new todo has besides its subject, all of it optional. */
export interface TodoNew {
	/** Whatever more there is to say about it. */
	text?: string;
	files?: Attachment[];
	/** Where it goes in the list, pushing those from there down; the bottom by default. */
	position?: number;
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
	}: TodoChange): Promise<Todo> {
		const words = wording(subject ?? this.subject, text ?? this.text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {
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
		const updated = await this.todos.revise(this.id, (state) => ({
			...state,
			...words,
			files: [...kept, ...added],
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
		/**
		 * Held while numbering a new todo, so two agents never share an id, and
		 * while writing one, so a move renumbering the rest never loses to a
		 * write of a position it just changed.
		 */
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
		subject: string,
		from: string | null,
		{ text = "", files = [], position }: TodoNew = {},
	): Promise<Todo> {
		const words = wording(subject, text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {});
		}
		await this.fs.mkdir(this.dir);
		return this.locked(async () => {
			// Numbered past every id handed out before, removed ones included, so
			// a number never comes back meaning something else.
			const id = (await this.lastId()) + 1;
			await this.fs.write(`${this.dir}/last`, String(id));
			const todo = await this.save({
				id,
				...words,
				position: 0,
				from,
				createdAt: new Date().toISOString(),
				takenBy: null,
				files: await this.attachments(id).store(files),
			});
			return this.place(todo.state, position);
		});
	}

	/**
	 * Top of the list first. A file that will not parse is skipped rather than
	 * fatal, and positions are counted again from 1 as they are read, so a
	 * gap or a tie left by a crash, or a todo saved before they had any (it
	 * goes below those that do, oldest first), never shows.
	 */
	async all(): Promise<Todo[]> {
		return (await this.stored()).map(
			(state, i) => new Todo(this, { ...state, position: i + 1 }),
		);
	}

	async find(id: number): Promise<Todo> {
		return (await this.all()).find((todo) => todo.id === id) ?? missing(id);
	}

	/** The todos `task` has taken; what a merge or remove settles. */
	async takenBy(task: string): Promise<Todo[]> {
		return (await this.all()).filter((todo) => todo.takenBy === task);
	}

	/**
	 * Puts a todo at `position`, 1 at the top, past the bottom meaning the
	 * bottom, and numbers the rest around it.
	 */
	async move(id: number, position: number): Promise<Todo> {
		return this.locked(async () => this.place(await this.state(id), position));
	}

	/**
	 * @internal Rewrites one todo as it stands on disk now, under the lock, so
	 * a change to its words or who has it never undoes a move made meanwhile.
	 */
	async revise(
		id: number,
		change: (state: TodoState) => TodoState,
	): Promise<Todo> {
		return this.locked(async () => this.save(change(await this.state(id))));
	}

	/** @internal Writes one todo. Rename makes the swap atomic for readers. */
	async save(state: TodoState): Promise<Todo> {
		const path = this.path(state.id);
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(state, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
		return new Todo(this, state);
	}

	/** @internal Removes one, moving those below it up to close the gap. */
	async delete(id: number): Promise<void> {
		await this.locked(async () => {
			await this.fs.rm(this.path(id), { force: true });
			await this.renumber(await this.stored());
		});
	}

	private async locked<T>(run: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await run();
		} finally {
			await this.lock.release();
		}
	}

	/** One todo as it stands on disk; call it under the lock. */
	private async state(id: number): Promise<TodoState> {
		const state = await this.read(this.path(id));
		return state ?? missing(id);
	}

	/**
	 * Slots `state` in at `position` among the rest and saves whichever moved.
	 * Call it under the lock.
	 */
	private async place(
		state: TodoState,
		position: number | undefined,
	): Promise<Todo> {
		if (
			position !== undefined &&
			(!Number.isInteger(position) || position <= 0)
		) {
			fail("usage", `'${position}' is not a position: 1 is the top`, {
				todo: state.id,
				position,
			});
		}
		const rest = (await this.stored()).filter((other) => other.id !== state.id);
		const at = Math.min((position ?? Infinity) - 1, rest.length);
		const order = [...rest.slice(0, at), state, ...rest.slice(at)];
		await this.renumber(order);
		return this.find(state.id);
	}

	/** Every todo in list order, with the positions it has on disk. */
	private async stored(): Promise<TodoState[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
		const states: TodoState[] = [];
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const state = await this.read(`${this.dir}/${entry}`);
			if (state) {
				states.push(state);
			}
		}
		return states.sort(
			(left, right) =>
				(left.position || Infinity) - (right.position || Infinity) ||
				left.id - right.id,
		);
	}

	/** Saves each todo in `order` whose position on disk is not its place there. */
	private async renumber(order: TodoState[]): Promise<void> {
		for (const [i, state] of order.entries()) {
			if (state.position !== i + 1) {
				await this.save({ ...state, position: i + 1 });
			}
		}
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
			// One saved before todos took files has none, rather than no list;
			// one saved before they had subjects has its first line as one; and
			// one saved before they had positions has 0 until `all` places it.
			const state = JSON.parse(raw) as Omit<
				TodoState,
				"files" | "subject" | "position"
			> & {
				files?: string[];
				subject?: string;
				position?: number;
			};
			return {
				...state,
				...(state.subject === undefined
					? wording(state.text, "")
					: { subject: state.subject, text: state.text }),
				position: state.position ?? 0,
				files: state.files ?? [],
			};
		} catch {
			return null;
		}
	}
}

function missing(id: number): never {
	fail("not_found", `no todo ${id}: run \`arbor todo list\``, { todo: id });
}

/**
 * A subject and its detail, trimmed. A subject running past one line keeps
 * only the first, the rest leading the detail, so the list stays one line a
 * todo however it was written.
 */
function wording(
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
 * whoever just finished it knows that context best, then the open one highest
 * on the list, which is how whoever keeps the list says what matters most.
 * Todos past `staleness` are never recommended, only offered for removal.
 */
export async function recommend(
	todos: Todos,
	task: string | null,
	staleness: number,
): Promise<Recommendation> {
	const open = (await todos.all())
		.filter((todo) => todo.takenBy === null)
		// Stable, so each half keeps its place in the list.
		.sort(
			(left, right) => Number(right.from === task) - Number(left.from === task),
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
}

export async function todoAdd(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{ text, files = [], position }: TodoAddOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.add(subject, from, {
		text,
		files: await readFiles(deps, files),
		position,
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
		log.info("no todos: `arbor todo add <subject>` defers work for later");
		return;
	}
	log.info(
		table(
			["POS", "ID", "SUBJECT", "FROM", "AGE", "TAKEN BY", "FILES"],
			all.map((todo) => [
				String(todo.position),
				String(todo.id),
				todo.subject,
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
	}: TodoUpdateOptions = {},
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
		subject: subject || undefined,
		text: text || undefined,
		position,
		files: await readFiles(deps, files),
		keep: todo.files.filter((path) => !dropped.includes(path)),
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

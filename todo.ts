import { color, type Logger } from "webappwiz/log";
import { type Fs, type Lock, NodeFs } from "webappwiz/system";
import { age } from "./age";
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

	remove(): Promise<void> {
		return this.todos.delete(this.id);
	}
}

/** What `Todos` is stored through; the real filesystem by default. */
export interface TodosOptions {
	fs?: Fs;
}

/** Every todo in the repo, one JSON file each under `.git/arbor/todos`. */
export class Todos {
	private readonly fs: Fs;

	constructor(
		private readonly dir: string,
		/** Held while numbering a new todo, so two agents never share an id. */
		private readonly lock: Lock,
		opts: TodosOptions = {},
	) {
		this.fs = opts.fs ?? new NodeFs();
	}

	async add(text: string, from: string | null): Promise<Todo> {
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
			return JSON.parse(raw) as TodoState;
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

export async function todoAdd(
	{ todos, log }: { todos: Todos; log: Logger },
	text: string,
	from: string | null,
): Promise<Todo> {
	const todo = await todos.add(text, from);
	log.info(
		`${color.green("added")} todo ${todo.id}\n  start it: arbor add <task> --todo ${todo.id}`,
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
			["ID", "TODO", "FROM", "AGE", "TAKEN BY"],
			all.map((todo) => [
				String(todo.id),
				todo.text,
				todo.from ?? "",
				age(todo.state.createdAt),
				todo.takenBy ?? "",
			]),
		),
	);
}

export async function todoRemove(
	{ todos, log }: { todos: Todos; log: Logger },
	id: number,
): Promise<void> {
	const todo = await todos.find(id);
	await todo.remove();
	log.info(`${color.green("removed")} todo ${id}: ${todo.text}`);
}

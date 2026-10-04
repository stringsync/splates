import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, type Lock, NodeFs } from "webappwiz/system";
import { Attachments } from "./attachments";
import { fail } from "./exit";
import {
	type TagState,
	Todo,
	type TodoNew,
	type TodoState,
	tagList,
	wording,
} from "./todo";

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
		{ text = "", files = [], position, tags = [] }: TodoNew = {},
	): Promise<Todo> {
		const words = wording(subject, text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {});
		}
		const tagged = tagList(tags);
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
				tags: tagged,
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

	/** Every tag a todo on the list has, by name, with how many have it. */
	async tags(): Promise<TagState[]> {
		const counts = new Map<string, number>();
		for (const todo of await this.all()) {
			for (const tag of todo.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return [...counts]
			.map(([tag, todos]) => ({ tag, todos }))
			.sort((left, right) => left.tag.localeCompare(right.tag));
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
			// one saved before they had positions has 0 until `all` places it;
			// one saved before tags has none.
			const state = JSON.parse(raw) as Omit<
				TodoState,
				"files" | "subject" | "position" | "tags"
			> & {
				files?: string[];
				tags?: string[];
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
				tags: state.tags ?? [],
			};
		} catch {
			return null;
		}
	}
}

/** What `Todos` is stored through; the real filesystem by default. */
export interface TodosOptions {
	fs?: Fs;
	/** Names stored files apart; a test counts. */
	ids?: IdProvider;
}

function missing(id: number): never {
	fail("not_found", `no todo ${id}: run \`arbor todo list\``, { todo: id });
}

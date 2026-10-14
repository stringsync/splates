import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, type Lock, NodeFs } from "webappwiz/system";
import { Attachments } from "./attachments";
import { fail } from "./exit";
import { cycle, type LaneRecord, misordered, settle } from "./lanes";
import { assigned, Todo, type TodoNew, type TodoState, wording } from "./todo";
import { parseTodoFile } from "./todo-file";
import { TodoLanes } from "./todo-lanes";

/** Every todo in the repo, one JSON file each under `.git/arbor/todos`. */
export class Todos {
	private readonly fs: Fs;
	private readonly ids: IdProvider;
	private readonly laneFiles: TodoLanes;

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
		this.laneFiles = new TodoLanes(this, this.fs);
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
		{
			text = "",
			files = [],
			position,
			blockedBy = [],
			lane = null,
			assignee = null,
		}: TodoNew = {},
	): Promise<Todo> {
		const words = wording(subject, text);
		if (words.subject === "") {
			fail("usage", "a todo needs a subject: say what is left to do", {});
		}
		await this.fs.mkdir(this.dir);
		return this.locked(async () => {
			const stored = await this.stored();
			// Nothing comes after a todo yet to exist, so a new one cannot close
			// a loop: only what it names has to be there.
			for (const id of blockedBy) {
				if (!stored.some((other) => other.id === id)) {
					missing(id);
				}
			}
			// Numbered past every id handed out before, removed ones included, so
			// a number never comes back meaning something else.
			const id = (await this.lastId()) + 1;
			await this.fs.write(`${this.dir}/last`, String(id));
			const state: TodoState = {
				id,
				...words,
				position: 0,
				from,
				createdAt: new Date().toISOString(),
				takenBy: null,
				files: await this.attachments(id).store(files),
				blockedBy: [...new Set(blockedBy)].sort((left, right) => left - right),
				lane: null,
			};
			const todo = await this.save(
				assigned(
					{
						...state,
						lane: await this.laneFiles.laneId(lane, stored, [state]),
					},
					assignee,
				),
			);
			await this.place(todo.state, position);
			return this.settled(todo.id);
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
	 * bottom, and numbers the rest around it. Refuses to put one above a todo
	 * in its own lane that it comes after, or below one that comes after it.
	 */
	async move(id: number, position: number): Promise<Todo> {
		return this.locked(async () => {
			const state = await this.state(id);
			this.ordered(slot(await this.stored(), state, position));
			return this.place(state, position);
		});
	}

	/**
	 * Says `id` comes after the todos in `add`, and no longer after those in
	 * `drop`: it is not to be started until they merge. Refuses a link that
	 * would make a loop, naming the todos in it, and moves a todo down below
	 * anything in its own lane it now comes after.
	 */
	async link(
		id: number,
		{ add = [], drop = [] }: { add?: number[]; drop?: number[] },
	): Promise<Todo> {
		return this.locked(async () => {
			const states = await this.stored();
			const state = states.find((other) => other.id === id) ?? missing(id);
			for (const before of add) {
				if (!states.some((other) => other.id === before)) {
					missing(before);
				}
				const loop = cycle(states, id, before);
				if (loop) {
					fail(
						"cycle",
						loop.length === 2
							? `todo ${id} cannot come after itself`
							: `todo ${id} cannot come after todo ${before}: that makes a loop, ${loop.map((each) => `#${each}`).join(" → ")}, where each has to merge before the next`,
						{ todo: id, blockedBy: before, cycle: loop },
					);
				}
			}
			const unknown = drop.find((before) => !state.blockedBy.includes(before));
			if (unknown !== undefined) {
				fail(
					"not_found",
					`todo ${id} does not come after todo ${unknown}: nothing was changed`,
					{ todo: id, blockedBy: unknown },
				);
			}
			await this.save({
				...state,
				blockedBy: [...new Set([...state.blockedBy, ...add])]
					.filter((before) => !drop.includes(before))
					.sort((left, right) => left - right),
			});
			return this.settled(id);
		});
	}

	/**
	 * Puts a todo in a lane, or in none for null. `"new"` starts a lane of its
	 * own, called `name`, or after the todo without one. With `before`, it goes just above that todo; otherwise it goes
	 * below the rest of the lane, or keeps its place when that is in none or
	 * new. Refuses a place above a todo in the lane that it comes after, or
	 * below one that comes after it.
	 */
	async arrange(
		id: number,
		lane: number | "new" | null,
		{ before, name }: { before?: number; name?: string } = {},
	): Promise<Todo> {
		return this.locked(async () => {
			const states = await this.stored();
			const state = states.find((other) => other.id === id) ?? missing(id);
			const moved = {
				...state,
				lane: await this.laneFiles.laneId(lane, states, [state], name),
			};
			const rest = states.filter((other) => other.id !== id);
			let at: number;
			if (before !== undefined) {
				at = rest.findIndex((other) => other.id === before);
				if (at === -1) {
					missing(before);
				}
			} else {
				const tail = rest.findLastIndex(
					(other) => moved.lane !== null && other.lane === moved.lane,
				);
				at =
					tail === -1 ? states.findIndex((other) => other.id === id) : tail + 1;
			}
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
			this.ordered(order);
			await this.save(moved);
			await this.renumber(order);
			return this.find(id);
		});
	}

	/** Every lane, in board order. */
	async lanes(): Promise<LaneRecord[]> {
		return this.laneFiles.records(await this.stored());
	}

	/** Moves every todo in lane `from` to the bottom of lane `into`; `from` is gone. */
	joinLanes(from: number, into: number): Promise<void> {
		return this.laneFiles.joinLanes(from, into);
	}

	/** Starts an empty lane called `name`, after the others. */
	addLane(name: string): Promise<LaneRecord> {
		return this.laneFiles.addLane(name);
	}

	/** Calls lane `id` by another name. */
	renameLane(id: number, name: string): Promise<LaneRecord> {
		return this.laneFiles.renameLane(id, name);
	}

	/** Puts lane `id` at `position` among the lanes, 1 the first column. */
	moveLane(id: number, position: number): Promise<LaneRecord[]> {
		return this.laneFiles.moveLane(id, position);
	}

	/** Removes lane `id`, putting its todos back in none, untriaged. */
	dropLane(id: number): Promise<void> {
		return this.laneFiles.dropLane(id);
	}

	/** @internal Removes each lane in `ids` that no todo is in any more. */
	endLanes(ids: number[]): Promise<void> {
		return this.laneFiles.endLanes(ids);
	}

	/** Moves todos saved while arbor kept tags into lanes, one lane a tag. */
	moveTagsToLanes(): Promise<{ lane: LaneRecord; todos: number[] }[]> {
		return this.laneFiles.moveTagsToLanes();
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

	/**
	 * @internal Removes one, moving those below it up to close the gap. What
	 * came after it no longer waits on it, so no todo is left naming one that
	 * is gone.
	 */
	async delete(id: number): Promise<void> {
		await this.locked(async () => {
			await this.fs.rm(this.path(id), { force: true });
			const order: TodoState[] = [];
			for (const state of await this.stored()) {
				if (state.blockedBy.includes(id)) {
					const freed = {
						...state,
						blockedBy: state.blockedBy.filter((before) => before !== id),
					};
					await this.save(freed);
					order.push(freed);
				} else {
					order.push(state);
				}
			}
			await this.renumber(order);
		});
	}

	/** @internal Runs `run` holding the lock every write goes through. */
	async locked<T>(run: () => Promise<T>): Promise<T> {
		await this.lock.acquire();
		try {
			return await run();
		} finally {
			await this.lock.release();
		}
	}

	/**
	 * Settles the list after a link or a lane changed, moving each todo below
	 * what it comes after in its lane, and gives back `id` as it ends up.
	 * Call it under the lock.
	 */
	private async settled(id: number): Promise<Todo> {
		await this.renumber(settle(await this.stored()));
		return this.find(id);
	}

	/** Refuses `order` when a lane in it puts a todo above one it comes after. */
	private ordered(order: TodoState[]): void {
		const wrong = misordered(order);
		if (wrong) {
			fail(
				"usage",
				`todo ${wrong.todo.id} comes after todo ${wrong.blockedBy.id} in lane ${wrong.todo.lane}, so it cannot go above it: \`arbor todo update ${wrong.todo.id} --remove-blocked-by ${wrong.blockedBy.id}\` first, or move it to another lane`,
				{
					todo: wrong.todo.id,
					blockedBy: wrong.blockedBy.id,
					lane: wrong.todo.lane,
				},
			);
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
		await this.renumber(slot(await this.stored(), state, position));
		return this.find(state.id);
	}

	/**
	 * @internal Every todo in list order, with the positions it has on disk. `tagged`
	 * are read though they still have tags, to move them into lanes.
	 */
	async stored(tagged: number[] = []): Promise<TodoState[]> {
		const entries = await this.fs.readdir(this.dir).catch(() => []);
		const states: TodoState[] = [];
		for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
			const state = await this.read(`${this.dir}/${entry}`, tagged);
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

	/** @internal Saves each todo in `order` whose position on disk is not its place there. */
	async renumber(order: TodoState[]): Promise<void> {
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

	/**
	 * One todo, or null when it will not parse. One saved with tags is
	 * refused, unless it is one of `tagged`: dropping them unasked would lose
	 * what they grouped.
	 */
	private async read(
		path: string,
		tagged: number[] = [],
	): Promise<TodoState | null> {
		const raw = await this.fs.read(path).catch(() => null);
		const found = raw === null ? null : parseTodoFile(raw);
		if (
			found !== null &&
			found.tags.length > 0 &&
			!tagged.includes(found.state.id)
		) {
			fail(
				"outdated",
				[
					`todo ${found.state.id} was saved with tags, and arbor now groups todos in lanes instead, so it reads no todos until their tags are moved.`,
					"Run `arbor update` in this repository: it puts each tag's todos in a lane named after the tag, then arbor works as before.",
				].join("\n"),
				{ todo: found.state.id },
			);
		}
		return found?.state ?? null;
	}
}

/** What `Todos` is stored through; the real filesystem by default. */
export interface TodosOptions {
	fs?: Fs;
	/** Names stored files apart; a test counts. */
	ids?: IdProvider;
}

/** `states` with `state` taken out and put back at `position`, 1 at the top. */
function slot(
	states: TodoState[],
	state: TodoState,
	position: number | undefined,
): TodoState[] {
	const rest = states.filter((other) => other.id !== state.id);
	const at = Math.min((position ?? Infinity) - 1, rest.length);
	return [...rest.slice(0, at), state, ...rest.slice(at)];
}

function missing(id: number): never {
	fail("not_found", `no todo ${id}: run \`arbor todo list\``, { todo: id });
}

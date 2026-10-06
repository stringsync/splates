import { type IdProvider, UuidProvider } from "webappwiz/id";
import { type Fs, type Lock, NodeFs } from "webappwiz/system";
import { Attachments } from "./attachments";
import { fail } from "./exit";
import {
	aptName,
	cycle,
	type LaneRecord,
	misordered,
	named,
	settle,
} from "./lanes";
import { Todo, type TodoNew, type TodoState, wording } from "./todo";

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
		{
			text = "",
			files = [],
			position,
			blockedBy = [],
			lane = null,
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
			const todo = await this.save({
				...state,
				lane: await this.laneId(lane, stored, [state]),
			});
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
				lane: await this.laneId(lane, states, [state], name),
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

	/**
	 * Moves every todo in lane `from` to the bottom of lane `into`, in the
	 * order they had, and the lane `from` is gone.
	 */
	async joinLanes(from: number, into: number): Promise<void> {
		await this.locked(async () => {
			const states = await this.stored();
			const records = await this.records(states);
			for (const lane of [from, into]) {
				lacking(records, lane);
			}
			const moving = states
				.filter((state) => state.lane === from)
				.map((state) => ({ ...state, lane: into }));
			const rest = states.filter((state) => state.lane !== from);
			const tail = rest.findLastIndex((state) => state.lane === into);
			const order = settle([
				...rest.slice(0, tail + 1),
				...moving,
				...rest.slice(tail + 1),
			]);
			for (const state of moving) {
				await this.save(state);
			}
			await this.renumber(order);
			await this.writeLanes(records.filter((record) => record.id !== from));
		});
	}

	/** Every lane, in board order. */
	async lanes(): Promise<LaneRecord[]> {
		return this.records(await this.stored());
	}

	/** Starts an empty lane called `name`, after the others. */
	async addLane(name: string): Promise<LaneRecord> {
		return this.locked(async () => {
			const states = await this.stored();
			const records = await this.records(states);
			// Named first, so a name refused never uses up a number.
			const called = laneName(name, records);
			const record = { id: await this.nextLaneId(states), name: called };
			await this.writeLanes([...records, record]);
			return record;
		});
	}

	/** Calls lane `id` by another name. */
	async renameLane(id: number, name: string): Promise<LaneRecord> {
		return this.locked(async () => {
			const records = await this.records(await this.stored());
			lacking(records, id);
			const others = records.filter((record) => record.id !== id);
			const renamed = { id, name: laneName(name, others) };
			await this.writeLanes(
				records.map((record) => (record.id === id ? renamed : record)),
			);
			return renamed;
		});
	}

	/**
	 * Puts lane `id` at `position` among the lanes, 1 the first column, past
	 * the last meaning the last; the others close up around it.
	 */
	async moveLane(id: number, position: number): Promise<LaneRecord[]> {
		if (!Number.isInteger(position) || position <= 0) {
			fail("usage", `'${position}' is not a position: 1 is the first lane`, {
				position,
			});
		}
		return this.locked(async () => {
			const records = await this.records(await this.stored());
			lacking(records, id);
			const moved = records.find((record) => record.id === id) as LaneRecord;
			const rest = records.filter((record) => record.id !== id);
			const at = Math.min(position - 1, rest.length);
			const order = [...rest.slice(0, at), moved, ...rest.slice(at)];
			await this.writeLanes(order);
			return order;
		});
	}

	/** Removes lane `id`, putting its todos back in none, untriaged. */
	async dropLane(id: number): Promise<void> {
		await this.locked(async () => {
			const states = await this.stored();
			const records = await this.records(states);
			lacking(records, id);
			for (const state of states.filter((state) => state.lane === id)) {
				await this.save({ ...state, lane: null });
			}
			await this.writeLanes(records.filter((record) => record.id !== id));
		});
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

	/**
	 * Moves todos saved while arbor kept tags into lanes, one lane a tag,
	 * and drops their tags, which arbor refuses to read until then. A todo
	 * in no lane goes to the lane of its tag the most todos share, at the
	 * bottom, in list order, below anything in that lane blocking it; a lane
	 * already called that takes them. Gives back each lane it filled, with
	 * the todos it put there, in board order; none once no todo has tags.
	 */
	async moveTagsToLanes(): Promise<{ lane: LaneRecord; todos: number[] }[]> {
		return this.locked(async () => {
			const entries = await this.fs.readdir(this.dir).catch(() => []);
			const parsed: { state: TodoState; tags: string[] }[] = [];
			for (const entry of entries.filter((entry) => entry.endsWith(".json"))) {
				const raw = await this.fs.read(`${this.dir}/${entry}`).catch(() => "");
				const found = parse(raw);
				if (found !== null && found.tags.length > 0) {
					parsed.push(found);
				}
			}
			if (parsed.length === 0) {
				return [];
			}
			const counts = new Map<string, number>();
			for (const { tags } of parsed) {
				for (const tag of tags) {
					counts.set(tag, (counts.get(tag) ?? 0) + 1);
				}
			}
			const states = await this.stored(parsed.map(({ state }) => state.id));
			const records = await this.records(states);
			const filled = new Map<number, number[]>();
			for (const state of states) {
				const tags = parsed.find((each) => each.state.id === state.id)?.tags;
				if (tags === undefined) {
					continue;
				}
				let lane = state.lane;
				if (lane === null) {
					const [tag] = [...tags].sort(
						(left, right) =>
							(counts.get(right) ?? 0) - (counts.get(left) ?? 0) ||
							left.localeCompare(right),
					) as [string];
					const name = tagName(tag);
					let record = records.find(
						(each) => each.name.toLowerCase() === name.toLowerCase(),
					);
					if (record === undefined) {
						record = { id: await this.nextLaneId(states), name };
						records.push(record);
						await this.writeLanes(records);
					}
					lane = record.id;
					filled.set(lane, [...(filled.get(lane) ?? []), state.id]);
				}
				// Saved even when its lane stays, so its tags are gone.
				await this.save({ ...state, lane });
			}
			await this.renumber(settle(await this.stored()));
			return records
				.filter((record) => filled.has(record.id))
				.map((lane) => ({ lane, todos: filled.get(lane.id) ?? [] }));
		});
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
			const gone = await this.read(this.path(id));
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
			// A lane whose last todo merged is done: it goes with it.
			const lane = gone?.lane ?? null;
			if (lane !== null && !order.some((state) => state.lane === lane)) {
				const records = await this.records(order);
				await this.writeLanes(records.filter((record) => record.id !== lane));
			}
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

	/**
	 * The lane `lane` names: null for none, one there is, or for `"new"` one
	 * started for `todos`, called `name` or named after them. Call it under
	 * the lock.
	 */
	private async laneId(
		lane: number | "new" | null,
		states: TodoState[],
		todos: TodoState[],
		name?: string,
	): Promise<number | null> {
		if (lane === null) {
			return null;
		}
		if (lane !== "new") {
			lacking(await this.records(states), lane);
			return lane;
		}
		return (await this.newLane(states, todos, name)).id;
	}

	/**
	 * Starts a lane for `todos` after the others, called `name`, or aptly
	 * named without one. Call it under the lock.
	 */
	private async newLane(
		states: TodoState[],
		todos: TodoState[],
		name?: string,
	): Promise<LaneRecord> {
		const records = await this.records(states);
		// Named first, so a name refused never uses up a number.
		const called =
			name === undefined
				? aptName(
						todos,
						records.map((each) => each.name),
					)
				: laneName(name, records);
		const record = { id: await this.nextLaneId(states), name: called };
		await this.writeLanes([...records, record]);
		return record;
	}

	/**
	 * A lane id never handed out before, so a lane's number never comes back
	 * meaning another. Call it under the lock.
	 */
	private async nextLaneId(states: TodoState[]): Promise<number> {
		const last = Number(
			await this.fs.read(`${this.dir}/last-lane`).catch(() => 0),
		);
		const records = await this.records(states);
		const id =
			Math.max(
				Number.isInteger(last) ? last : 0,
				...records.map((record) => record.id),
			) + 1;
		await this.fs.mkdir(this.dir);
		await this.fs.write(`${this.dir}/last-lane`, String(id));
		return id;
	}

	/**
	 * The lanes as stored, and after them any lane a todo is in that has no
	 * record. A file that will not parse reads as none.
	 */
	private async records(states: TodoState[]): Promise<LaneRecord[]> {
		const raw = await this.fs.read(`${this.dir}/lanes`).catch(() => "[]");
		let stored: LaneRecord[] = [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				stored = parsed.filter(
					(each): each is LaneRecord =>
						Number.isInteger(each?.id) && typeof each?.name === "string",
				);
			}
		} catch {}
		return named(states, stored);
	}

	/** Writes the lanes, in board order. Call it under the lock. */
	private async writeLanes(records: LaneRecord[]): Promise<void> {
		await this.fs.mkdir(this.dir);
		const path = `${this.dir}/lanes`;
		const tmp = `${path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(tmp, `${JSON.stringify(records, null, "\t")}\n`);
		await this.fs.rename(tmp, path);
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
	 * Every todo in list order, with the positions it has on disk. `tagged`
	 * are read though they still have tags, to move them into lanes.
	 */
	private async stored(tagged: number[] = []): Promise<TodoState[]> {
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
		const found = raw === null ? null : parse(raw);
		if (
			found !== null &&
			found.tags.length > 0 &&
			!tagged.includes(found.state.id)
		) {
			fail(
				"outdated",
				[
					`todo ${found.state.id} was saved with tags, and arbor now groups todos in lanes instead, so it reads no todos until their tags are moved.`,
					"Run `bunx @webappwiz/cli update` in this repository: it puts each tag's todos in a lane named after the tag, then arbor works as before.",
				].join("\n"),
				{ todo: found.state.id },
			);
		}
		return found?.state ?? null;
	}
}

/** A todo as stored, with any tags it was saved with; null when it will not parse. */
function parse(raw: string): { state: TodoState; tags: string[] } | null {
	try {
		// One saved before todos took files has none, rather than no list; one
		// saved before they had subjects has its first line as one; one saved
		// before they had positions has 0 until `all` places it; and one saved
		// before links and lanes is blocked by nothing, in none.
		const { tags = [], ...state } = JSON.parse(raw) as Omit<
			TodoState,
			"files" | "subject" | "position" | "blockedBy" | "lane"
		> & {
			files?: string[];
			tags?: string[];
			subject?: string;
			position?: number;
			blockedBy?: number[];
			lane?: number | null;
		};
		return {
			state: {
				...state,
				...(state.subject === undefined
					? wording(state.text, "")
					: { subject: state.subject, text: state.text }),
				position: state.position ?? 0,
				files: state.files ?? [],
				blockedBy: state.blockedBy ?? [],
				lane: state.lane ?? null,
			},
			tags,
		};
	} catch {
		return null;
	}
}

/** The lane a tag becomes: `dark-mode` is `Dark mode`. */
function tagName(tag: string): string {
	const words = tag.replaceAll("-", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
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

/** Refuses a lane `records` lacks. */
function lacking(records: LaneRecord[], id: number): void {
	if (!records.some((record) => record.id === id)) {
		fail(
			"not_found",
			`no lane ${id}: run \`arbor lane list\`, or pass \`new\` to start one`,
			{ lane: id },
		);
	}
}

/** `name` trimmed, refused when empty or when another lane has it. */
function laneName(name: string, others: LaneRecord[]): string {
	const trimmed = name.trim();
	if (trimmed === "") {
		fail("usage", "a lane needs a name: say what its todos are for", {});
	}
	const same = others.find(
		(other) => other.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (same) {
		fail(
			"exists",
			`lane ${same.id} is already called '${same.name}': pick another name`,
			{ lane: same.id, name: same.name },
		);
	}
	return trimmed;
}

function missing(id: number): never {
	fail("not_found", `no todo ${id}: run \`arbor todo list\``, { todo: id });
}

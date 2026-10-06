import { basename } from "node:path";
import { color, type Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { age } from "./age";
import { type Attachment, type Attachments, readFiles } from "./attachments";
import { fail } from "./exit";
import {
	blockerLabel,
	blockersOf,
	followers,
	isReady,
	type LaneRecord,
	type LaneState,
	lane,
	mentioned,
} from "./lanes";
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
	/**
	 * The todos that have to merge before this one starts, sorted. One leaves
	 * the list when it merges or is removed, and with it every link to it.
	 */
	blockedBy: number[];
	/** The lane it runs in, one agent's queue, or null for none. */
	lane: number | null;
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

	/**
	 * The todos blocking it that have yet to merge, leaving out those `task`
	 * has or takes in the same breath, among `together`: what it should not be
	 * started before.
	 */
	async blockers(task: string, together: number[] = []): Promise<Todo[]> {
		if (this.takenBy === task) {
			return [];
		}
		return (await this.todos.all()).filter(
			(other) =>
				this.blockedBy.includes(other.id) &&
				other.takenBy !== task &&
				!together.includes(other.id),
		);
	}

	/** Marks it as the work of `task`, refusing one another task already has. */
	async take(task: string): Promise<Todo> {
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

	/** The todos that have to merge before it starts. */
	get blockedBy(): number[] {
		return this.state.blockedBy;
	}

	get lane(): number | null {
		return this.state.lane;
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
		blockedBy,
		lane,
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
		let linked = updated;
		if (blockedBy !== undefined) {
			linked = await this.todos.link(this.id, {
				add: blockedBy.filter((id) => !updated.blockedBy.includes(id)),
				drop: updated.blockedBy.filter((id) => !blockedBy.includes(id)),
			});
		}
		if (lane !== undefined && lane !== linked.lane) {
			linked = await this.todos.arrange(this.id, lane);
		}
		return position === undefined ? linked : this.todos.move(this.id, position);
	}

	async remove(): Promise<void> {
		await this.todos.delete(this.id);
		await this.attachments.clear();
	}
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
	/** Every todo blocking it from now on; the old stay when this is absent. */
	blockedBy?: number[];
	/** The lane it runs in, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
}

/** What a new todo has besides its subject, all of it optional. */
export interface TodoNew {
	/** Whatever more there is to say about it. */
	text?: string;
	files?: Attachment[];
	/** Where it goes in the list, pushing those from there down; the bottom by default. */
	position?: number;
	/** The todos blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
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
	/**
	 * The lane the finished task's todos ran in, when it has more to do:
	 * `next` is its next step then, even one another lane still blocks.
	 */
	lane?: LaneState;
	/** Every lane there is now, to name those `lane` is blocked by. */
	records?: LaneRecord[];
	/** A lane the finished task's todos emptied: its agent is done. */
	finished?: LaneRecord;
}

/**
 * Which todo to take up after `task`. A task whose todos ran in a lane goes
 * on down that lane, since that is what its agent was handed. Otherwise one
 * that came up in it first, since whoever just finished it knows that context
 * best, then the open one highest on the list, which is how
 * whoever keeps the list says what matters most; never one still blocked by
 * another yet to merge. Todos past `staleness` are never recommended, only
 * offered for removal.
 */
export async function recommend(
	todos: Todos,
	task: string | null,
	staleness: number,
	ran: LaneRecord[] = [],
): Promise<Recommendation> {
	const all = await todos.all();
	const states = all.map((todo) => todo.state);
	const stale = all.filter(
		(todo) => todo.takenBy === null && todo.waited > staleness,
	);
	const records = await todos.lanes();
	for (const record of ran) {
		const found = lane(states, record);
		if (found.next !== null) {
			return {
				next: all.find((todo) => todo.id === found.next?.id) ?? null,
				stale,
				lane: found,
				records,
			};
		}
	}
	const finished = ran.find(
		(record) => lane(states, record).todos.length === 0,
	);
	const rank = (todo: Todo) => (todo.from === task ? 1 : 0);
	const open = all
		.filter((todo) => isReady(todo.state))
		// Stable, so each group keeps its place in the list.
		.sort((left, right) => rank(right) - rank(left));
	return {
		next: open.find((todo) => todo.waited <= staleness) ?? null,
		stale,
		...(finished === undefined ? {} : { finished }),
	};
}

/** The lines `merge` ends with, or none when there is nothing to say. */
export function recommendation({
	next,
	stale,
	lane,
	records = [],
	finished,
}: Recommendation): string[] {
	const lines: string[] = [];
	if (finished !== undefined) {
		lines.push(
			"",
			`${color.bold(`lane ${finished.id} ${finished.name}`)} is done: nothing is left in it, so it is gone`,
		);
	}
	if (next && lane) {
		lines.push(
			"",
			`${color.bold(`next in lane ${lane.id} ${lane.name}`)} todo ${next.id}: ${next.subject}`,
			...lane.blockers.map(
				(blocker) =>
					`  ${color.yellow("blocked by")} ${blockerLabel(blocker, records)}, ${blocker.takenBy === null ? "not taken yet" : `taken by ${blocker.takenBy}`}: arbor todo wait ${blocker.id}`,
			),
			`  ${lane.blockers.length === 0 ? "start it" : "then start it"}: arbor add <task> --todo ${next.id}`,
		);
	} else if (next) {
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
	/**
	 * Only those free to start now: nobody has taken them, and nothing they
	 * is blocked by is still open.
	 */
	ready?: boolean;
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
	/** The todos blocking it: each has to merge before it starts. */
	blockedBy?: number[];
	/** The lane it goes in, `"new"` for one of its own; none by default. */
	lane?: number | "new" | null;
}

export async function todoAdd(
	deps: { todos: Todos; log: Logger; fs: Fs; ps: Ps },
	subject: string,
	from: string | null,
	{ text, files = [], position, blockedBy, lane }: TodoAddOptions = {},
): Promise<Todo> {
	const todo = await deps.todos.add(subject, from, {
		text,
		files: await readFiles(deps, files),
		position,
		blockedBy,
		lane,
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

export async function todoList(
	{ todos, log }: { todos: Todos; log: Logger },
	{ json = false, open = false, ready = false }: TodoListOptions = {},
): Promise<void> {
	const every = await todos.all();
	const listed = every.filter(
		(todo) =>
			(!open || todo.takenBy === null) && (!ready || isReady(todo.state)),
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
			ready
				? "no ready todos: each is taken or blocked by one still open, see `arbor todo list`"
				: "no open todos: every one is taken, see `arbor todo list`",
		);
		return;
	}
	log.info(
		table(
			[
				"POS",
				"ID",
				"SUBJECT",
				"BLOCKED BY",
				"LANE",
				"FROM",
				"AGE",
				"TAKEN BY",
				"FILES",
			],
			listed.map((todo) => [
				String(todo.position),
				String(todo.id),
				todo.subject,
				todo.blockedBy.join(","),
				todo.lane === null ? "" : String(todo.lane),
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
	const states = (await todos.all()).map((each) => each.state);
	// How another todo stands, in a few words: where it runs, who has it.
	const where = (other: TodoState) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? null : `taken by ${other.takenBy}`,
		].filter(Boolean);
	const named = (other: TodoState) => {
		const said = where(other);
		return `#${other.id} ${other.subject}${said.length === 0 ? "" : ` (${said.join(", ")})`}`;
	};
	const records = await todos.lanes();
	const record = records.find((each) => each.id === todo.lane);
	const steps = record === undefined ? [] : lane(states, record).todos;
	const step = steps.findIndex((other) => other.id === todo.id);
	const lines = [
		`${color.bold(`todo ${todo.id}`)} ${todo.subject}`,
		`  position:  ${todo.position}`,
		`  from:      ${todo.from ?? "added by hand"}`,
		`  taken by:  ${todo.takenBy ?? "nobody yet"}`,
		...(todo.lane === null
			? []
			: [
					`  lane:      ${todo.lane} ${record?.name ?? ""}, step ${step + 1} of ${steps.length}`,
				]),
		...blockersOf(states, todo.state).map(
			(wait) =>
				`  blocked by: ${named(states.find((other) => other.id === wait.id) as TodoState)}`,
		),
		...followers(states, todo.id).map(
			(other) => `  blocking:  ${named(other)}`,
		),
		`  age:       ${age(todo.state.createdAt)}`,
		...todo.files.map((path) => `  file:      ${path}`),
	];
	// A mention of a todo that has gone reads as if it were still there, so
	// each is said to be open or gone: ids never come back, and a gone one has
	// merged or been removed.
	const mentions = mentioned(`${todo.subject}\n${todo.text}`).filter(
		(id) => id !== todo.id,
	);
	for (const id of mentions) {
		const other = states.find((each) => each.id === id);
		lines.push(
			`  mentions:  ${other ? named(other) : `#${id}, gone: merged or removed`}`,
		);
	}
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
	/** Todos blocking it from now on, besides those that already do. */
	blockedBy?: number[];
	/** Todos no longer blocking it. */
	removeBlockedBy?: number[];
	/** The lane it moves to, `"new"` for one of its own, null for none; it stays when absent. */
	lane?: number | "new" | null;
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

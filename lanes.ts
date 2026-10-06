import type { TodoState } from "./todo";

/**
 * What blocks which todos, and the lanes they run in, worked out from the
 * todos alone. Nothing here reads or writes the disk, so the CLI and the
 * `arbor dev` page draw the same lanes from the same list.
 */

/** A todo that has to merge first, and where it stands now. */
export interface Blocker {
	id: number;
	subject: string;
	/** The lane it is in, or null when it is in none. */
	lane: number | null;
	/** The task working on it, or null while nobody has it. */
	takenBy: string | null;
}

/**
 * A lane as stored: its number, never handed out again once it is gone, and
 * what it is called. Lanes are kept in the order the board shows them.
 */
export interface LaneRecord {
	id: number;
	name: string;
}

/** One agent's queue: the todos it works through, top first. */
export interface LaneState {
	id: number;
	name: string;
	todos: TodoState[];
	/** The tasks at work on its todos now, top first: who is on the lane. */
	agents: string[];
	/** The first todo no task has taken: what the lane's agent does next. */
	next: TodoState | null;
	/**
	 * Todos in other lanes, or in none, blocking `next` that have
	 * yet to merge: what the lane is waiting on before it can go on.
	 */
	blockers: Blocker[];
	/** `next` can be taken now: nothing blocking it is left but in this lane's hands. */
	ready: boolean;
}

/**
 * Every lane, in the order `records` keeps them, each with its todos in list
 * order. A lane some todo is in but `records` lacks, as one written before
 * lanes had names, comes last, called by its number.
 */
export function lanes(todos: TodoState[], records: LaneRecord[]): LaneState[] {
	return named(todos, records).map((record) => lane(todos, record));
}

/** `records`, and after them a record for each lane a todo is in that they lack. */
export function named(todos: TodoState[], records: LaneRecord[]): LaneRecord[] {
	const unnamed = [
		...new Set(
			todos.flatMap((todo) =>
				todo.lane === null || records.some((record) => record.id === todo.lane)
					? []
					: [todo.lane],
			),
		),
	].sort((left, right) => left - right);
	return [...records, ...unnamed.map((id) => ({ id, name: `Lane ${id}` }))];
}

/** The lane `record` stands for, empty when no todo is in it. */
export function lane(todos: TodoState[], { id, name }: LaneRecord): LaneState {
	const steps = todos
		.filter((todo) => todo.lane === id)
		.sort((left, right) => left.position - right.position);
	const next = steps.find((todo) => todo.takenBy === null) ?? null;
	const agents = [
		...new Set(
			steps.flatMap((todo) => (todo.takenBy === null ? [] : [todo.takenBy])),
		),
	];
	// What blocks it in its own lane is the lane's own work, taken or
	// about to be: only what the other lanes owe it blocks the lane.
	const blockers =
		next === null
			? []
			: blockersOf(todos, next).filter((blocker) => blocker.lane !== id);
	return {
		id,
		name,
		todos: steps,
		agents,
		next,
		blockers,
		ready: next !== null && blockersOf(todos, next).length === 0,
	};
}

/** What blocks `todo` and has yet to merge, in list order. */
export function blockersOf(todos: TodoState[], todo: TodoState): Blocker[] {
	return todos
		.filter((other) => todo.blockedBy.includes(other.id))
		.map(({ id, subject, lane, takenBy }) => ({ id, subject, lane, takenBy }));
}

/** The todos `id` blocks, in list order. */
export function followers(todos: TodoState[], id: number): TodoState[] {
	return todos.filter((todo) => todo.blockedBy.includes(id));
}

/** Nothing blocking it is still open, and nobody has it: free to start. */
export function isReady(todo: TodoState): boolean {
	return todo.takenBy === null && todo.blockedBy.length === 0;
}

/**
 * The todos that would form a loop if `blocker` blocked `id`, as the chain
 * from `id` round to itself in merge order, or null when there is none. A
 * loop is `id` already blocking `blocker`, however far down.
 */
export function cycle(
	todos: TodoState[],
	id: number,
	blocker: number,
): number[] | null {
	if (id === blocker) {
		return [id, id];
	}
	const byId = new Map(todos.map((todo) => [todo.id, todo]));
	// Walk back from `blocker` through what blocks it, looking for `id`.
	const trail = (from: number, seen: Set<number>): number[] | null => {
		if (from === id) {
			return [id];
		}
		if (seen.has(from)) {
			return null;
		}
		seen.add(from);
		for (const before of byId.get(from)?.blockedBy ?? []) {
			const found = trail(before, seen);
			if (found) {
				return [...found, from];
			}
		}
		return null;
	};
	const found = trail(blocker, new Set());
	return found && [...found, id];
}

/**
 * `todos` in list order, but with each one below every todo in its own lane
 * that blocks it: a todo that would come too soon is moved down to just
 * below the last of them, and everything else keeps its place.
 */
export function settle(todos: TodoState[]): TodoState[] {
	const pending = [...todos];
	const placed = new Set<number>();
	const byId = new Map(todos.map((todo) => [todo.id, todo]));
	const free = (todo: TodoState) =>
		todo.lane === null ||
		todo.blockedBy.every(
			(id) => placed.has(id) || byId.get(id)?.lane !== todo.lane,
		);
	const order: TodoState[] = [];
	while (pending.length > 0) {
		// The links have no loop, so one is always free; the first stands in
		// for safety, should a hand-edited file ever make one.
		const at = Math.max(0, pending.findIndex(free));
		const [todo] = pending.splice(at, 1) as [TodoState];
		placed.add(todo.id);
		order.push(todo);
	}
	return order;
}

/**
 * The first pair in `todos`, in list order, where a todo sits above one in
 * its own lane that blocks it; null when the lanes all keep to their
 * links.
 */
export function misordered(
	todos: TodoState[],
): { todo: TodoState; blockedBy: TodoState } | null {
	const at = new Map(todos.map((todo, i) => [todo.id, i]));
	for (const [i, todo] of todos.entries()) {
		if (todo.lane === null) {
			continue;
		}
		for (const id of todo.blockedBy) {
			const before = todos[at.get(id) ?? -1];
			if (before && before.lane === todo.lane && (at.get(id) ?? -1) > i) {
				return { todo, blockedBy: before };
			}
		}
	}
	return null;
}

/** A blocking todo, and the lane it is in by name: `#177 in Licensing`. */
export function blockerLabel(
	{ id, lane }: { id: number; lane: number | null },
	records: LaneRecord[],
): string {
	const name = records.find((record) => record.id === lane)?.name;
	return `#${id}${lane === null ? "" : ` in ${name ?? `lane ${lane}`}`}`;
}

/**
 * A name for a lane holding `todos`, none of `taken`: its first todo's
 * subject, numbered past any lane already called that. The user renames it
 * to what the run adds up to.
 */
export function aptName(todos: TodoState[], taken: string[]): string {
	const used = new Set(taken.map((name) => name.toLowerCase()));
	const base = todos[0]?.subject ?? "New lane";
	let name = base;
	for (let count = 2; used.has(name.toLowerCase()); count++) {
		name = `${base} ${count}`;
	}
	return name;
}

/**
 * The todos a markdown text mentions as `#N`, once each, in the order
 * mentioned. Code spans and blocks are left out, where `#3` means something
 * else, as is `#N` inside a word or a link like `page#2`.
 */
export function mentioned(text: string): number[] {
	const prose = text.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, " ");
	return [
		...new Set([...prose.matchAll(MENTION)].map((match) => Number(match[1]))),
	];
}

/** `#` and a number, standing on its own. */
export const MENTION = /(?<![\w/#&])#(\d+)\b/g;

import type { TaskRecord } from "./task";

/**
 * What blocks which tasks, and the lanes they run in, worked out from the
 * tasks alone. Nothing here reads or writes the disk, so the CLI and the
 * `splates server` page draw the same lanes from the same list.
 */

/**
 * Every lane, in the order `records` keeps them, each with its tasks in list
 * order. A lane some task is in but `records` lacks, as one written before
 * lanes had names, comes last, called by its number.
 */
export function lanes(tasks: TaskRecord[], records: LaneRecord[]): LaneState[] {
	return named(tasks, records).map((record) => lane(tasks, record));
}

/**
 * A lane as stored: its number, never handed out again once it is gone, and
 * what it is called. Lanes are kept in the order the board shows them.
 */
export interface LaneRecord {
	id: number;
	name: string;
	/**
	 * Whether the person queued the whole lane: each of its tasks is queued
	 * as soon as nothing blocks it, until the lane is empty. Absent for no.
	 */
	queued?: true;
	/**
	 * The tasks the person took out of the queue while the lane was queued,
	 * which it leaves out until they are queued again.
	 */
	skip?: number[];
	/**
	 * How many more tasks the lane may queue on its own before it stops for
	 * the person to approve more: each one `queueFromLanes` queues takes one.
	 * Set when the lane is queued; absent for a lane queued before budgets,
	 * which has no limit.
	 */
	budget?: number;
}

/** A queue of tasks that build on each other, worked top first. */
export interface LaneState {
	id: number;
	name: string;
	todos: TaskRecord[];
	/** The started tasks at work on its queued ones now, top first: who is on the lane. */
	agents: string[];
	/** The first task no started task has taken: what the lane's orchestrator hands out next. */
	next: TaskRecord | null;
	/**
	 * Tasks in other lanes, or in none, blocking `next` that have
	 * yet to merge: what the lane is waiting on before it can go on.
	 */
	blockers: Blocker[];
	/** `next` can be taken now: nothing blocking it is left but in this lane's hands. */
	ready: boolean;
	/** Whether the person queued the whole lane, as `LaneRecord.queued`. */
	queued: boolean;
	/** The tasks it may still queue on its own, as `LaneRecord.budget`; absent for no limit. */
	budget?: number;
}

/** A task that has to merge first, and where it stands now. */
export interface Blocker {
	id: number;
	subject: string;
	/** The lane it is in, or null when it is in none. */
	lane: number | null;
	/** The task working on it, or null while nobody has it. */
	takenBy: string | null;
}

/**
 * The lane of each queued task some started task has taken, by the started
 * task's name: which lane each agent at work is on.
 */
export function lanesTaken(
	todos: readonly TaskRecord[],
): Record<string, number> {
	const taken: Record<string, number> = {};
	for (const todo of todos) {
		if (todo.takenBy !== null && todo.lane !== null) {
			taken[todo.takenBy] = todo.lane;
		}
	}
	return taken;
}

/** `records`, and after them a record for each lane a task is in that they lack. */
export function named(
	tasks: TaskRecord[],
	records: LaneRecord[],
): LaneRecord[] {
	const unnamed = [
		...new Set(
			tasks.flatMap((task) =>
				task.lane === null || records.some((record) => record.id === task.lane)
					? []
					: [task.lane],
			),
		),
	].sort((left, right) => left - right);
	return [...records, ...unnamed.map((id) => ({ id, name: `Lane ${id}` }))];
}

/** The lane `record` stands for, empty when no task is in it. */
export function lane(
	tasks: TaskRecord[],
	{ id, name, queued, budget }: LaneRecord,
): LaneState {
	const steps = tasks
		.filter((task) => task.lane === id)
		.sort((left, right) => left.position - right.position);
	const next = steps.find((task) => task.takenBy === null) ?? null;
	const agents = [
		...new Set(
			steps.flatMap((task) => (task.takenBy === null ? [] : [task.takenBy])),
		),
	];
	// What blocks it in its own lane is the lane's own work, taken or
	// about to be: only what the other lanes owe it blocks the lane.
	const blockers =
		next === null
			? []
			: blockersOf(tasks, next).filter((blocker) => blocker.lane !== id);
	return {
		id,
		name,
		todos: steps,
		agents,
		next,
		blockers,
		ready: next !== null && blockersOf(tasks, next).length === 0,
		queued: queued === true,
		...(queued === true && budget !== undefined ? { budget } : {}),
	};
}

/**
 * Whether the queued lane `task` is in passes over it, because the person
 * took it out of the queue: only queueing it by hand puts it back.
 */
export function isSkipped(
	records: readonly LaneRecord[],
	task: TaskRecord,
): boolean {
	return records.some(
		(record) =>
			record.id === task.lane &&
			record.queued === true &&
			(record.skip ?? []).includes(task.id),
	);
}

/** What blocks `task` and has yet to merge, in list order. */
export function blockersOf(tasks: TaskRecord[], task: TaskRecord): Blocker[] {
	return tasks
		.filter((other) => task.blockedBy.includes(other.id))
		.map(({ id, subject, lane, takenBy }) => ({ id, subject, lane, takenBy }));
}

/** The tasks `id` blocks, in list order. */
export function followers(tasks: TaskRecord[], id: number): TaskRecord[] {
	return tasks.filter((task) => task.blockedBy.includes(id));
}

/**
 * Nothing blocking it is still open, none was removed from under it, and
 * nobody has it: free to start.
 */
export function isReady(task: TaskRecord): boolean {
	return (
		task.takenBy === null &&
		task.blockedBy.length === 0 &&
		(task.blockersLost ?? []).length === 0
	);
}

/**
 * The tasks that would form a loop if `blocker` blocked `id`, as the chain
 * from `id` round to itself in merge order, or null when there is none. A
 * loop is `id` already blocking `blocker`, however far down.
 */
export function cycle(
	tasks: TaskRecord[],
	id: number,
	blocker: number,
): number[] | null {
	if (id === blocker) {
		return [id, id];
	}
	const byId = new Map(tasks.map((task) => [task.id, task]));
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
 * `tasks` in list order, but with each one below every task in its own lane
 * that blocks it: a task that would come too soon is moved down to just
 * below the last of them, and everything else keeps its place.
 */
export function settle(tasks: TaskRecord[]): TaskRecord[] {
	const pending = [...tasks];
	const placed = new Set<number>();
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const free = (task: TaskRecord) =>
		task.lane === null ||
		task.blockedBy.every(
			(id) => placed.has(id) || byId.get(id)?.lane !== task.lane,
		);
	const order: TaskRecord[] = [];
	while (pending.length > 0) {
		// The links have no loop, so one is always free; the first stands in
		// for safety, should a hand-edited file ever make one.
		const at = Math.max(0, pending.findIndex(free));
		const [task] = pending.splice(at, 1) as [TaskRecord];
		placed.add(task.id);
		order.push(task);
	}
	return order;
}

/**
 * The first pair in `tasks`, in list order, where a task sits above one in
 * its own lane that blocks it; null when the lanes all keep to their
 * links.
 */
export function misordered(
	tasks: TaskRecord[],
): { task: TaskRecord; blockedBy: TaskRecord } | null {
	const at = new Map(tasks.map((task, i) => [task.id, i]));
	for (const [i, task] of tasks.entries()) {
		if (task.lane === null) {
			continue;
		}
		for (const id of task.blockedBy) {
			const before = tasks[at.get(id) ?? -1];
			if (before && before.lane === task.lane && (at.get(id) ?? -1) > i) {
				return { task, blockedBy: before };
			}
		}
	}
	return null;
}

/** A blocking task, and the lane it is in by name: `#177 in Licensing`. */
export function blockerLabel(
	{ id, lane }: { id: number; lane: number | null },
	records: LaneRecord[],
): string {
	const name = records.find((record) => record.id === lane)?.name;
	return `#${id}${lane === null ? "" : ` in ${name ?? `lane ${lane}`}`}`;
}

/**
 * A name for a lane holding `tasks`, none of `taken`: its first task's
 * subject, numbered past any lane already called that. The user renames it
 * to what the run adds up to.
 */
export function aptName(tasks: TaskRecord[], taken: string[]): string {
	const used = new Set(taken.map((name) => name.toLowerCase()));
	const base = tasks[0]?.subject ?? "New lane";
	let name = base;
	for (let count = 2; used.has(name.toLowerCase()); count++) {
		name = `${base} ${count}`;
	}
	return name;
}

/**
 * The tasks a markdown text mentions as `#N`, once each, in the order
 * mentioned. Code spans and blocks are left out, where `#3` means something
 * else, as is `#N` inside a word or a link like `page#2`, and one named as
 * the task of a project among `others`, by slug (see `elsewhereMention`).
 */
export function mentioned(
	text: string,
	others: readonly string[] = [],
): number[] {
	const prose = text.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, " ");
	const elsewhere = elsewhereMention(others);
	const own = elsewhere === null ? prose : prose.replace(elsewhere, " ");
	return [
		...new Set([...own.matchAll(MENTION)].map((match) => Number(match[1]))),
	];
}

/** `#` and a number, standing on its own, not escaped as `\#`. */
export const MENTION = /(?<![\w/#&\\])#(\d+)\b/g;

/**
 * A `#N` named as the task of another project, by its slug among `others`
 * just before it, as agents write it: `webappwiz #404`, `webappwiz task #404`,
 * `webappwiz#404` or `#webappwiz #404`, the slug in any case. Group 1 is the
 * slug as written, group 2 the number; null when there are no others.
 */
export function elsewhereMention(others: readonly string[]): RegExp | null {
	if (others.length === 0) {
		return null;
	}
	// The longest first, so `app-2` is read whole rather than as `app`.
	const slugs = [...others]
		.sort((one, other) => other.length - one.length)
		.map((slug) => slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|");
	return new RegExp(
		`(?<![\\w/#&])#?(${slugs})(?:[ \\t]+task)?[ \\t]*#(\\d+)\\b`,
		"gi",
	);
}

/**
 * Why `task` waits on the person, its blockers removed without merging,
 * and how to let it go on.
 */
export function lostLine(task: TaskRecord): string {
	const lost = task.blockersLost ?? [];
	return `waits on you: ${lost.map((gone) => `#${gone.id}`).join(", ")} it was blocked by ${lost.length === 1 ? "was" : "were"} removed without merging. If it still makes sense: splates task update ${task.id} ${lost.map((gone) => `--remove-blocked-by ${gone.id}`).join(" ")}`;
}

/**
 * The tasks a lane may queue on its own once queued whole, beyond those it
 * holds then: room for the follow-ups its agents add, before it asks.
 */
export const LANE_SLACK = 20;

/** A queued lane shows its budget, and the button to add to it, at or below this many tasks left. */
export const BUDGET_LOW = 3;

/** The tasks an approval adds to a queued lane's budget: one size, no choice. */
export const APPROVAL = 20;

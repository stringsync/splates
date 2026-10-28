import type {
	ElsewhereBlocker,
	TaskRecord,
} from "@stringsync/splates-server/board";
import type { AgentPick } from "@stringsync/splates-server/models";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import type { Snapshot } from "@stringsync/splates-server/tasks";

/**
 * What each board write will make of the snapshot, so `Feed.expect` knows
 * when the server's copy holds it. Each is keyed by what it touches, and the
 * page shows that pending until then.
 */

/** Todo `id` for `assignee` to work, or nobody in particular for null. */
export function assigned(id: number, assignee: AgentPick | null) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot =>
			changed(snapshot, id, ({ assignee: _, ...todo }) =>
				assignee === null ? todo : { ...todo, assignee },
			),
	);
}

/**
 * Todo `id` blocked by `blockedBy`. A blocker removed without merging that
 * `blockedBy` leaves out is let go of.
 */
// scry-ignore doc-comments-address-users: this comment predates the check and describes what the user sees
export function linked(id: number, blockedBy: readonly number[]) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot =>
			changed(snapshot, id, ({ blockersLost, ...todo }) => {
				const lost = (blockersLost ?? []).filter((gone) =>
					blockedBy.includes(gone.id),
				);
				return {
					...todo,
					blockedBy: [...new Set(blockedBy)]
						.filter((each) => !lost.some((gone) => gone.id === each))
						.sort((left, right) => left - right),
					...(lost.length === 0 ? {} : { blockersLost: lost }),
				};
			}),
	);
}

/** Todo `id` blocked by exactly the tasks of other projects in `blockers`. */
export function linkedElsewhere(
	id: number,
	blockers: readonly ElsewhereBlocker[],
) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot =>
			changed(snapshot, id, ({ blockedElsewhere: _, ...todo }) => ({
				...todo,
				...(blockers.length === 0 ? {} : { blockedElsewhere: [...blockers] }),
			})),
	);
}

/**
 * Todo `id` at the bottom of `lane`, or in a new lane called `name` for
 * `"new"`; put in none, it keeps its place in the list.
 */
export function arranged(id: number, lane: number | "new" | null, name = "") {
	return keyed(`todo:${id}`, (snapshot: Snapshot): Snapshot => {
		const todo = snapshot.todos.find((each) => each.id === id);
		if (todo === undefined) {
			return snapshot;
		}
		if (lane === null) {
			return changed(snapshot, id, (each) => ({ ...each, lane: null }));
		}
		if (lane === "new") {
			const fresh = freeLane(snapshot);
			return {
				...changed(snapshot, id, (each) => ({ ...each, lane: fresh })),
				lanes: [...snapshot.lanes, { id: fresh, name }],
			};
		}
		const rest = snapshot.todos.filter((each) => each.id !== id);
		const tail = rest.findLastIndex((each) => each.lane === lane);
		const moved = { ...todo, lane };
		return {
			...snapshot,
			todos:
				tail === -1
					? snapshot.todos.map((each) => (each.id === id ? moved : each))
					: [...rest.slice(0, tail + 1), moved, ...rest.slice(tail + 1)],
		};
	});
}

/**
 * Todo `id` in the queue, or out of it, where the server puts it: ready
 * once groomed, else the backlog.
 */
export function queued(id: number, queued: boolean) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot =>
			changed(snapshot, id, (todo) => ({
				...todo,
				stage: queued ? "queued" : todo.groomed ? "ready" : "backlog",
			})),
	);
}

/**
 * Queued todo `id` at `place` in the queue, 1 the next to start, just ahead
 * of the one now there; the server settles the positions it really takes.
 */
export function queueMoved(id: number, place: number) {
	return keyed(`todo:${id}`, (snapshot: Snapshot): Snapshot => {
		const order = queueOrder(snapshot.todos).filter((todo) => todo.id !== id);
		const at = order[place - 1];
		const last = order.at(-1);
		const position = at ? at.position - 0.5 : (last?.position ?? 0) + 1;
		return changed(snapshot, id, (todo) => ({ ...todo, position }));
	});
}

/** Lane `id` called `name`. */
export function laneRenamed(id: number, name: string) {
	return keyed(
		`lane:${id}`,
		(snapshot: Snapshot): Snapshot => ({
			...snapshot,
			lanes: snapshot.lanes.map((lane) =>
				lane.id === id ? { ...lane, name } : lane,
			),
		}),
	);
}

/**
 * An empty lane called `name` after the others, under a number no lane has
 * until the server names it; none once the server's has a lane so called.
 */
export function laneAdded(name: string) {
	return keyed(
		"lane:new",
		(snapshot: Snapshot): Snapshot =>
			snapshot.lanes.some((lane) => lane.name === name)
				? snapshot
				: {
						...snapshot,
						lanes: [...snapshot.lanes, { id: freeLane(snapshot), name }],
					},
	);
}

/** Lane `from`'s todos at the bottom of lane `into`, in the order they had, and `from` gone. */
export function lanesJoined(from: number, into: number) {
	return keyed(`lane:${from}`, (snapshot: Snapshot): Snapshot => {
		const moving = snapshot.todos
			.filter((todo) => todo.lane === from)
			.map((todo) => ({ ...todo, lane: into }));
		const rest = snapshot.todos.filter((todo) => todo.lane !== from);
		const tail = rest.findLastIndex((todo) => todo.lane === into);
		return {
			...snapshot,
			todos: [...rest.slice(0, tail + 1), ...moving, ...rest.slice(tail + 1)],
			lanes: snapshot.lanes.filter((lane) => lane.id !== from),
		};
	});
}

/**
 * Each todo of lane `id` no agent has queued, from the backlog or ready, or
 * when not `queued`, each of its queued ones back in ready when groomed,
 * else the backlog.
 */
export function laneQueued(id: number, queued: boolean) {
	return keyed(
		`lane:${id}`,
		(snapshot: Snapshot): Snapshot => ({
			...snapshot,
			todos: snapshot.todos.map((todo) =>
				todo.lane !== id || todo.takenBy !== null
					? todo
					: queued
						? todo.stage === "backlog" || todo.stage === "ready"
							? { ...todo, stage: "queued" }
							: todo
						: todo.stage === "queued"
							? { ...todo, stage: todo.groomed ? "ready" : "backlog" }
							: todo,
			),
		}),
	);
}

/** Lane `id` gone, and its todos with it. */
export function laneDropped(id: number) {
	return keyed(
		`lane:${id}`,
		(snapshot: Snapshot): Snapshot => ({
			...snapshot,
			todos: snapshot.todos.filter((todo) => todo.lane !== id),
			lanes: snapshot.lanes.filter((lane) => lane.id !== id),
		}),
	);
}

/** Task `task` gone from the board, as removing it leaves it. */
export function taskRemoved(task: string) {
	return keyed(
		`task:${task}`,
		(snapshot: Snapshot): Snapshot => ({
			...snapshot,
			tasks: snapshot.tasks.filter((each) => each.task !== task),
		}),
	);
}

/** Todo `id` off the list. */
export function todoRemoved(id: number) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot => ({
			...snapshot,
			todos: snapshot.todos.filter((todo) => todo.id !== id),
		}),
	);
}

/**
 * `todo`, removed, back where it stood, as the server puts it back: in its
 * lane while there is one, blocked by what is still on the list.
 */
export function todoRestored(todo: TaskRecord) {
	return keyed(`todo:${todo.id}`, (snapshot: Snapshot): Snapshot => {
		if (snapshot.todos.some((each) => each.id === todo.id)) {
			return snapshot;
		}
		const back = {
			...todo,
			takenBy: null,
			lane: snapshot.lanes.some((lane) => lane.id === todo.lane)
				? todo.lane
				: null,
			blockedBy: todo.blockedBy.filter((id) =>
				snapshot.todos.some((each) => each.id === id),
			),
		};
		const at = snapshot.todos.findIndex(
			(each) => each.position >= todo.position,
		);
		return {
			...snapshot,
			todos:
				at === -1
					? [...snapshot.todos, back]
					: [...snapshot.todos.slice(0, at), back, ...snapshot.todos.slice(at)],
		};
	});
}

/** What a todo is added with, as the page sends it. */
export interface Adding {
	subject: string;
	text: string;
	lane: number | null;
	/** Where in the list it goes, 1 at the top; at the bottom without one. */
	position?: number;
}

/**
 * A todo `adding` describes, under an id no todo has until the server
 * numbers it; none once the server's list has one so called that `known`,
 * the ids the list held as it was added, lacks.
 */
export function todoAdded(adding: Adding, known: ReadonlySet<number>) {
	return keyed("todo:new", (snapshot: Snapshot): Snapshot => {
		if (
			snapshot.todos.some(
				(todo) => !known.has(todo.id) && todo.subject === adding.subject,
			)
		) {
			return snapshot;
		}
		const todo: TaskRecord = {
			id: -1 - known.size,
			subject: adding.subject,
			text: adding.text,
			position: adding.position ?? snapshot.todos.length + 1,
			from: null,
			createdAt: new Date().toISOString(),
			takenBy: null,
			files: [],
			blockedBy: [],
			lane: adding.lane,
			stage: "backlog",
		};
		const at =
			adding.position === undefined
				? snapshot.todos.length
				: Math.max(0, Math.min(adding.position - 1, snapshot.todos.length));
		return {
			...snapshot,
			todos: [
				...snapshot.todos.slice(0, at),
				todo,
				...snapshot.todos.slice(at),
			],
		};
	});
}

/** Todo `id` reworded, its files those `kept` names, as an edit saves it. */
export function todoEdited(
	id: number,
	{
		subject,
		text,
		kept,
	}: { subject: string; text: string; kept: readonly string[] },
) {
	return keyed(
		`todo:${id}`,
		(snapshot: Snapshot): Snapshot =>
			changed(snapshot, id, (todo) => ({
				...todo,
				subject,
				text,
				files: todo.files.filter((file) => kept.includes(file)),
			})),
	);
}

/** A lane number no lane on the board has. */
function freeLane(snapshot: Snapshot): number {
	return (
		Math.max(
			0,
			...snapshot.lanes.map((lane) => lane.id),
			...snapshot.laneNames.map((lane) => lane.id),
			...snapshot.todos.map((todo) => todo.lane ?? 0),
		) + 1
	);
}

/** `snapshot` with todo `id` changed by `change`. */
function changed(
	snapshot: Snapshot,
	id: number,
	change: (todo: TaskRecord) => TaskRecord,
): Snapshot {
	return {
		...snapshot,
		todos: snapshot.todos.map((todo) => (todo.id === id ? change(todo) : todo)),
	};
}

/** `expectation` tagged with the `key` of what it touches, for `Feed.expect` to hold pending. */
function keyed(
	key: string,
	expectation: (snapshot: Snapshot) => Snapshot,
): (snapshot: Snapshot) => Snapshot {
	return Object.assign(expectation, { key });
}

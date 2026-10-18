import type { TodoState } from "@stringsync/splates-server/board";
import type { AgentPick } from "@stringsync/splates-server/models";
import type { Snapshot } from "@stringsync/splates-server/tasks";

/**
 * What each board write is to make of the snapshot, for `Feed.expect` to show
 * at the click: each turns the snapshot as the server last said it into what
 * it will say once the write lands, as near as the page can tell. Kept here,
 * apart from the controls, so how the board guesses lives in one place.
 */

/** Todo `id` for `assignee` to work, or nobody in particular for null. */
export function assigned(id: number, assignee: AgentPick | null) {
	return (snapshot: Snapshot): Snapshot =>
		changed(snapshot, id, ({ assignee: _, ...todo }) =>
			assignee === null ? todo : { ...todo, assignee },
		);
}

/** Todo `id` blocked by `blockedBy`, sorted as the server keeps them. */
export function linked(id: number, blockedBy: readonly number[]) {
	return (snapshot: Snapshot): Snapshot =>
		changed(snapshot, id, (todo) => ({
			...todo,
			blockedBy: [...new Set(blockedBy)].sort((left, right) => left - right),
		}));
}

/**
 * Todo `id` at the bottom of `lane`, or in a new lane called `name` for
 * `"new"`; put in none, it keeps its place in the list.
 */
export function arranged(id: number, lane: number | "new" | null, name = "") {
	return (snapshot: Snapshot): Snapshot => {
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
	};
}

/** Lane `id` called `name`. */
export function laneRenamed(id: number, name: string) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		lanes: snapshot.lanes.map((lane) =>
			lane.id === id ? { ...lane, name } : lane,
		),
	});
}

/**
 * An empty lane called `name` after the others, under a number no lane has
 * until the server names it; none once the server's has a lane so called.
 */
export function laneAdded(name: string) {
	return (snapshot: Snapshot): Snapshot =>
		snapshot.lanes.some((lane) => lane.name === name)
			? snapshot
			: {
					...snapshot,
					lanes: [...snapshot.lanes, { id: freeLane(snapshot), name }],
				};
}

/** Lane `from`'s todos at the bottom of lane `into`, in the order they had, and `from` gone. */
export function lanesJoined(from: number, into: number) {
	return (snapshot: Snapshot): Snapshot => {
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
	};
}

/** Lane `id` gone, its todos back in none. */
export function laneDropped(id: number) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		todos: snapshot.todos.map((todo) =>
			todo.lane === id ? { ...todo, lane: null } : todo,
		),
		lanes: snapshot.lanes.filter((lane) => lane.id !== id),
	});
}

/** Task `task` gone from the board, as removing it leaves it. */
export function taskRemoved(task: string) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		tasks: snapshot.tasks.filter((each) => each.task !== task),
	});
}

/** Todo `id` off the list. */
export function todoRemoved(id: number) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		todos: snapshot.todos.filter((todo) => todo.id !== id),
	});
}

/**
 * `todo`, removed, back where it stood, as the server puts it back: in its
 * lane while there is one, blocked by what is still on the list.
 */
export function todoRestored(todo: TodoState) {
	return (snapshot: Snapshot): Snapshot => {
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
	};
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
	return (snapshot: Snapshot): Snapshot => {
		if (
			snapshot.todos.some(
				(todo) => !known.has(todo.id) && todo.subject === adding.subject,
			)
		) {
			return snapshot;
		}
		const todo: TodoState = {
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
	};
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
	return (snapshot: Snapshot): Snapshot =>
		changed(snapshot, id, (todo) => ({
			...todo,
			subject,
			text,
			files: todo.files.filter((file) => kept.includes(file)),
		}));
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
	change: (todo: TodoState) => TodoState,
): Snapshot {
	return {
		...snapshot,
		todos: snapshot.todos.map((todo) => (todo.id === id ? change(todo) : todo)),
	};
}

import type { TaskRecord } from "@stringsync/splates-server/board";
import { isReady } from "@stringsync/splates-server/board/browser";
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

/** Todo `id` queued only by hand when `manual`, by a queued lane too when not. */
export function manualOf(id: number, manual: boolean) {
	return (snapshot: Snapshot): Snapshot =>
		changed(snapshot, id, ({ manual: _, ...todo }) =>
			manual ? { ...todo, manual: true as const } : todo,
		);
}

/**
 * Todo `id` blocked by `blockedBy`, sorted as the server keeps them; a
 * blocker removed without merging that it leaves out is let go of.
 */
export function linked(id: number, blockedBy: readonly number[]) {
	return (snapshot: Snapshot): Snapshot =>
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
		});
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

/**
 * Todo `id` in the queue, or out of it, where the server puts it: ready
 * once groomed, else the backlog.
 */
export function queued(id: number, queued: boolean) {
	return (snapshot: Snapshot): Snapshot =>
		changed(snapshot, id, (todo) => ({
			...todo,
			stage: queued ? "queued" : todo.groomed ? "ready" : "backlog",
		}));
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

/**
 * Lane `id` queued whole, each of its todos nothing blocks queued with it,
 * or no longer, each of its queued todos no agent has back in ready when
 * groomed, else the backlog.
 */
export function laneQueued(id: number, queued: boolean) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		todos: snapshot.todos.map((todo) =>
			todo.lane !== id
				? todo
				: queued
					? todo.stage !== "queued" && isReady(todo)
						? { ...todo, stage: "queued" }
						: todo
					: todo.stage === "queued" && todo.takenBy === null
						? { ...todo, stage: todo.groomed ? "ready" : "backlog" }
						: todo,
		),
		lanes: snapshot.lanes.map((lane) => {
			if (lane.id !== id) {
				return lane;
			}
			const { queued: _, skip: __, budget: ___, ...rest } = lane;
			return queued ? { ...rest, queued: true as const } : rest;
		}),
	});
}

/** Queued lane `id` allowed `more` tasks beyond its budget left. */
export function laneApproved(id: number, more: number) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		lanes: snapshot.lanes.map((lane) =>
			lane.id === id && lane.queued === true && lane.budget !== undefined
				? { ...lane, budget: lane.budget + more }
				: lane,
		),
	});
}

/** Lane `id` gone, and its todos with it. */
export function laneDropped(id: number) {
	return (snapshot: Snapshot): Snapshot => ({
		...snapshot,
		todos: snapshot.todos.filter((todo) => todo.lane !== id),
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
export function todoRestored(todo: TaskRecord) {
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
	change: (todo: TaskRecord) => TaskRecord,
): Snapshot {
	return {
		...snapshot,
		todos: snapshot.todos.map((todo) => (todo.id === id ? change(todo) : todo)),
	};
}

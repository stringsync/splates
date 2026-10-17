import { Dispatcher, type Eventful } from "webappwiz/events";
import type { LaneRecord } from "../lanes";
import type { TodoState } from "../todo";
import { arrangeTodo, moveLane, moveTodo } from "./api";

export type TodoBoardEvents = { changed: undefined };

/**
 * Where a card is let go: onto another card, which it takes the place of, or
 * onto a column's empty space, which puts it at the bottom of that lane (or
 * leaves it where it is in the list, for the todos in no lane). `"new"` is the
 * column that starts a lane, once it is named.
 */
export type Target = { card: number } | { lane: number | null | "new" };

/** The writes a drop makes: the server's by default. */
export interface BoardWrites {
	/** Puts a todo at a position in the whole list, 1 at the top. */
	move(id: number, position: number): Promise<void>;
	/**
	 * Puts a todo in a lane, above `before` or at the bottom of it; a new
	 * lane is called `name`.
	 */
	arrange(
		id: number,
		lane: number | "new" | null,
		before?: number,
		name?: string,
	): Promise<void>;
	/** Puts a lane at a position among the lanes, 1 the first column. */
	moveLane(id: number, position: number): Promise<void>;
}

/** What the board shows of the todos it was given. */
export interface BoardShown {
	/** The todos in list order, each in the lane it shows in. */
	todos: TodoState[];
	/** The todo in hand, while one is dragged. */
	lifted?: TodoState;
}

/**
 * The board's order while cards and lanes are dragged, across the todo
 * column and the lanes: which card or lane is in hand, and the list as just
 * dropped, shown until the server's catches up, so a card or a lane lands
 * where it was let go instead of jumping back for a poll. Any new list of
 * todos or lanes is the server's word, and the dropped order gives way to it.
 */
export class TodoBoard implements Eventful<TodoBoardEvents> {
	private readonly dispatcher = new Dispatcher<TodoBoardEvents>();
	readonly events = this.dispatcher.events;

	/** The id of the card in hand, while one is dragged. */
	dragging: number | null = null;
	/** The list dropped, and the list it was dropped on, until a refusal or a new list. */
	dropped: { todos: TodoState[]; on: TodoState[] } | null = null;
	/** The id of the card dropped to start a lane, until the lane is named. */
	naming: number | null = null;
	/** The id of the lane in hand, while one is dragged by its header. */
	draggingLane: number | null = null;
	/** The lanes as dropped, and the lanes they were dropped on, until a refusal or new lanes. */
	droppedLanes: { lanes: LaneRecord[]; on: LaneRecord[] } | null = null;

	constructor(
		private readonly writes: BoardWrites = {
			move: moveTodo,
			arrange: arrangeTodo,
			moveLane,
		},
	) {}

	/** The lanes in the order the board shows them. */
	showLanes(lanes: LaneRecord[]): LaneRecord[] {
		return this.droppedLanes?.on === lanes ? this.droppedLanes.lanes : lanes;
	}

	liftLane(id: number): void {
		this.draggingLane = id;
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Drops lane `id` onto lane `onto`, taking its place the way a Trello
	 * list does, and makes the write that puts it there; null when that
	 * moves nothing.
	 */
	dropLane(
		lanes: LaneRecord[],
		id: number,
		onto: number | null,
	): Promise<void> | null {
		this.draggingLane = null;
		const at = this.showLanes(lanes).findIndex((lane) => lane.id === onto);
		if (at === -1) {
			this.dispatcher.dispatch("changed");
			return null;
		}
		return this.moveLane(lanes, id, at + 1);
	}

	/**
	 * Puts lane `id` at `position` among the lanes, 1 the first, shown there
	 * at once; null when it is there already. A write the server refuses puts
	 * the lanes back, and is thrown from the promise.
	 */
	moveLane(
		lanes: LaneRecord[],
		id: number,
		position: number,
	): Promise<void> | null {
		const shown = this.showLanes(lanes);
		const lane = shown.find((each) => each.id === id);
		const rest = shown.filter((each) => each.id !== id);
		const at = Math.max(0, Math.min(position - 1, rest.length));
		if (lane === undefined || shown.indexOf(lane) === at) {
			this.dispatcher.dispatch("changed");
			return null;
		}
		const dropped = {
			lanes: [...rest.slice(0, at), lane, ...rest.slice(at)],
			on: lanes,
		};
		this.droppedLanes = dropped;
		this.dispatcher.dispatch("changed");
		return this.writes.moveLane(id, at + 1).catch((error: unknown) => {
			if (this.droppedLanes === dropped) {
				this.droppedLanes = null;
				this.dispatcher.dispatch("changed");
			}
			throw error;
		});
	}

	show(todos: TodoState[]): BoardShown {
		const shown = this.dropped?.on === todos ? this.dropped.todos : todos;
		return {
			todos: shown,
			lifted: todos.find((todo) => todo.id === this.dragging),
		};
	}

	lift(id: number): void {
		this.dragging = id;
		this.dispatcher.dispatch("changed");
	}

	/** Puts the card or lane in hand back where it was. */
	cancel(): void {
		this.dragging = null;
		this.draggingLane = null;
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Drops card `id` onto `target`, or onto nothing, and makes the write that
	 * puts it there; null when that moves nothing, or when it waits for the
	 * name of the lane it starts. Onto a card in its own column it takes that
	 * card's place in the list; onto a card in another, it joins that lane
	 * just above it. A write the server refuses puts the board back, and is
	 * thrown from the promise.
	 */
	drop(
		todos: TodoState[],
		id: number,
		target: Target | null,
	): Promise<void> | null {
		this.dragging = null;
		if (target !== null && "lane" in target && target.lane === "new") {
			this.naming = id;
			this.dispatcher.dispatch("changed");
			return null;
		}
		return this.land(todos, id, target);
	}

	/**
	 * Starts the lane called `name` for the card dropped to start one, as
	 * `drop` makes its writes; null when no card waits for a name.
	 */
	name(todos: TodoState[], name: string): Promise<void> | null {
		const id = this.naming;
		if (id === null) {
			return null;
		}
		this.naming = null;
		// A name refused, one another lane has, leaves it waiting for another.
		return (
			this.land(todos, id, { lane: "new" }, name)?.catch((error: unknown) => {
				this.naming = id;
				this.dispatcher.dispatch("changed");
				throw error;
			}) ?? null
		);
	}

	/** Puts the card waiting for a lane's name back where it was. */
	unname(): void {
		this.naming = null;
		this.dispatcher.dispatch("changed");
	}

	private land(
		todos: TodoState[],
		id: number,
		target: Target | null,
		name?: string,
	): Promise<void> | null {
		const list = this.show(todos).todos;
		const card = list.find((todo) => todo.id === id);
		const plan = card && target && this.plan(list, card, target, name);
		if (!plan) {
			this.dispatcher.dispatch("changed");
			return null;
		}
		const dropped = { todos: plan.todos, on: todos };
		this.dropped = dropped;
		this.dispatcher.dispatch("changed");
		return plan.write().catch((error: unknown) => {
			if (this.dropped === dropped) {
				this.dropped = null;
				this.dispatcher.dispatch("changed");
			}
			throw error;
		});
	}

	/** The list as it shows once `card` lands on `target`, and the write that makes it so. */
	private plan(
		list: TodoState[],
		card: TodoState,
		target: Target,
		name?: string,
	): { todos: TodoState[]; write: () => Promise<void> } | null {
		const rest = list.filter((todo) => todo.id !== card.id);
		if ("card" in target) {
			const onto = list.find((todo) => todo.id === target.card);
			if (onto === undefined || onto.id === card.id) {
				return null;
			}
			if (onto.lane === card.lane) {
				// Its place in the whole list, which is not its index in the
				// column when the column shows only part of the list.
				const to = list.indexOf(onto);
				const todos = [...rest];
				todos.splice(to, 0, card);
				return {
					todos,
					write: () => this.writes.move(card.id, onto.position),
				};
			}
			const at = rest.indexOf(onto);
			return {
				todos: [
					...rest.slice(0, at),
					{ ...card, lane: onto.lane },
					...rest.slice(at),
				],
				write: () => this.writes.arrange(card.id, onto.lane, onto.id),
			};
		}
		const { lane } = target;
		if (lane === card.lane) {
			return null;
		}
		if (lane === "new") {
			// Shown under a number no lane has, until the server names it.
			const fresh = Math.max(0, ...list.map((todo) => todo.lane ?? 0)) + 1;
			return {
				todos: list.map((todo) =>
					todo.id === card.id ? { ...todo, lane: fresh } : todo,
				),
				write: () => this.writes.arrange(card.id, "new", undefined, name),
			};
		}
		const tail =
			lane === null ? -1 : rest.findLastIndex((todo) => todo.lane === lane);
		const moved = { ...card, lane };
		const todos =
			tail === -1
				? list.map((todo) => (todo.id === card.id ? moved : todo))
				: [...rest.slice(0, tail + 1), moved, ...rest.slice(tail + 1)];
		return { todos, write: () => this.writes.arrange(card.id, lane) };
	}
}

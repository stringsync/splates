import { Dispatcher, type Eventful } from "webappwiz/events";
import type { TodoState } from "../todo";
import { moveTodo } from "./api";

export type TodoBoardEvents = { changed: undefined };

/** What the column shows of the todos it was given. */
export interface BoardShown {
	/** Every card's id, top first, in the order it shows. */
	ids: number[];
	/** The todos, in that order. */
	todos: TodoState[];
	/** The todo in hand, while one is dragged. */
	lifted?: TodoState;
}

/**
 * The todo column's order while cards are dragged: which one is in hand,
 * and the order just dropped, shown until the server's catches up, so a card
 * lands where it was let go instead of jumping back for a poll. Any new list
 * of todos is the server's word, and the dropped order gives way to it.
 */
export class TodoBoard implements Eventful<TodoBoardEvents> {
	private readonly dispatcher = new Dispatcher<TodoBoardEvents>();
	readonly events = this.dispatcher.events;

	/** The id of the card in hand, while one is dragged. */
	dragging: number | null = null;
	/** The order dropped, and the list it was dropped on, until a refusal or a new list. */
	dropped: { ids: number[]; on: TodoState[] } | null = null;

	constructor(
		/** Puts a todo at a position, 1 at the top; the server's by default. */
		private readonly move: (
			id: number,
			position: number,
		) => Promise<void> = moveTodo,
	) {}

	show(todos: TodoState[]): BoardShown {
		const ids =
			this.dropped?.on === todos
				? this.dropped.ids
				: todos.map((todo) => todo.id);
		return {
			ids,
			todos: ids.flatMap((id) => todos.filter((todo) => todo.id === id)),
			lifted: todos.find((todo) => todo.id === this.dragging),
		};
	}

	lift(id: number): void {
		this.dragging = id;
		this.dispatcher.dispatch("changed");
	}

	/** Puts the card in hand back where it was. */
	cancel(): void {
		this.dragging = null;
		this.dispatcher.dispatch("changed");
	}

	/**
	 * Drops card `id` onto the card `onto`, or onto nothing, and moves it
	 * there on the server; null when that moves nothing. A move the server
	 * refuses puts the order back, and is thrown from the promise.
	 */
	drop(
		todos: TodoState[],
		id: number,
		onto: number | null,
	): Promise<void> | null {
		this.dragging = null;
		if (onto === null || onto === id) {
			this.dispatcher.dispatch("changed");
			return null;
		}
		const { ids } = this.show(todos);
		const to = ids.indexOf(onto);
		const order = ids.filter((each) => each !== id);
		order.splice(to, 0, id);
		const dropped = { ids: order, on: todos };
		this.dropped = dropped;
		this.dispatcher.dispatch("changed");
		// The place of the card it landed on, which is not its index when the
		// list shows only one tag's todos.
		const position = todos.find((todo) => todo.id === onto)?.position ?? to + 1;
		return this.move(id, position).catch((error: unknown) => {
			if (this.dropped === dropped) {
				this.dropped = null;
				this.dispatcher.dispatch("changed");
			}
			throw error;
		});
	}
}

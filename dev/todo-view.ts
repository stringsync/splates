import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";

export type TodoViewEvents = { changed: undefined };

/** What the todo list shows of a snapshot, given what has been picked. */
export interface TodosShown {
	/** Every tag any todo has, sorted. */
	tags: string[];
	/** The tag the list is narrowed to, if any. */
	tag: string | null;
	/** The todos the tag lets through, top of the list first. */
	todos: TodoState[];
	/** The todo open in its dialog, and its neighbors in the list shown. */
	current?: TodoState;
	previous?: TodoState;
	next?: TodoState;
	/** The bottom position of the whole list, not just of the todos shown. */
	last: number;
	/** The task open in its dialog. */
	task?: Snapshot["tasks"][number];
	/** Nothing is open over the list, so the list's own keys apply. */
	bare: boolean;
}

/**
 * The todo list's choices: which tag it is narrowed to, which todo or task is
 * open, and whether the shortcuts show. `show` applies them to a snapshot,
 * which can change under them: a choice the snapshot no longer has room for
 * shows as nothing picked.
 */
export class TodoView implements Eventful<TodoViewEvents> {
	private readonly dispatcher = new Dispatcher<TodoViewEvents>();
	readonly events = this.dispatcher.events;

	picked: string | null = null;
	opened: number | null = null;
	openedTask: string | null = null;
	keysShown = false;

	show(snapshot: Snapshot): TodosShown {
		const tags = [
			...new Set(snapshot.todos.flatMap((todo) => todo.tags)),
		].sort();
		// A tag whose last todo went has nothing left to show, and lets go.
		const tag =
			this.picked !== null && tags.includes(this.picked) ? this.picked : null;
		const todos = snapshot.todos.filter(
			(todo) => tag === null || todo.tags.includes(tag),
		);
		const at = todos.findIndex((todo) => todo.id === this.opened);
		const current = todos[at];
		const task = snapshot.tasks.find((found) => found.task === this.openedTask);
		return {
			tags,
			tag,
			todos,
			current,
			previous: current && todos[at - 1],
			next: current && todos[at + 1],
			last: Math.max(0, ...snapshot.todos.map((todo) => todo.position)),
			task,
			bare: current === undefined && task === undefined && !this.keysShown,
		};
	}

	pick(tag: string | null): void {
		this.set({ picked: tag });
	}

	open(id: number): void {
		this.set({ opened: id });
	}

	close(): void {
		this.set({ opened: null });
	}

	/** Opens the top todo shown; false when something else is open over it. */
	openTop(snapshot: Snapshot): boolean {
		const { bare, todos } = this.show(snapshot);
		const top = todos[0];
		if (!bare || top === undefined) {
			return false;
		}
		this.open(top.id);
		return true;
	}

	openTask(snapshot: Snapshot, name: string): void {
		// Only a task the page knows of opens: one merged a moment ago has no
		// details left to show.
		if (snapshot.tasks.some((found) => found.task === name)) {
			this.set({ openedTask: name });
		}
	}

	closeTask(): void {
		this.set({ openedTask: null });
	}

	/** Lists the shortcuts; false when something is open over the list. */
	showKeys(snapshot: Snapshot): boolean {
		if (!this.show(snapshot).bare) {
			return false;
		}
		this.set({ keysShown: true });
		return true;
	}

	hideKeys(): void {
		this.set({ keysShown: false });
	}

	private set(
		next: Partial<
			Pick<TodoView, "picked" | "opened" | "openedTask" | "keysShown">
		>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

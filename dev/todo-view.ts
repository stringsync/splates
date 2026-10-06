import { Dispatcher, type Eventful } from "webappwiz/events";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";

export type TodoViewEvents = { changed: undefined };

/** What the todo list shows of a snapshot, given what has been picked. */
export interface TodosShown {
	/** Every todo, top of the list first. */
	todos: TodoState[];
	/** The todo open in its dialog. */
	current?: TodoState;
	/** The task open in its dialog. */
	task?: Snapshot["tasks"][number];
}

/** Where the lanes hidden from the board are kept between visits. */
const HIDDEN = "arbor.hiddenLanes";

/**
 * The todo list's choices: which todo or task is open, and which lanes the
 * board leaves out, `null` for the untriaged. `show` applies them to a
 * snapshot, which can change under them: a choice the snapshot no longer has room for
 * shows as nothing picked.
 */
export class TodoView implements Eventful<TodoViewEvents> {
	private readonly dispatcher = new Dispatcher<TodoViewEvents>();
	readonly events = this.dispatcher.events;

	opened: number | null = null;
	openedTask: string | null = null;
	hidden: (number | null)[];

	/** `storage` keeps the hidden lanes for the next visit, when given. */
	constructor(private readonly storage?: Storage) {
		this.hidden = hiddenIn(storage);
	}

	show(snapshot: Snapshot): TodosShown {
		const { todos } = snapshot;
		return {
			todos,
			current: todos.find((todo) => todo.id === this.opened),
			task: snapshot.tasks.find((found) => found.task === this.openedTask),
		};
	}

	open(id: number): void {
		this.set({ opened: id });
	}

	close(): void {
		this.set({ opened: null });
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

	/** Shows lane `lane`, or the untriaged for null, if hidden, else hides it. */
	toggleLane(lane: number | null): void {
		this.hide(
			this.hidden.includes(lane)
				? this.hidden.filter((other) => other !== lane)
				: [...this.hidden, lane],
		);
	}

	/** Hides `lanes`, null for the untriaged, and shows every other. */
	hide(lanes: (number | null)[]): void {
		this.storage?.setItem(HIDDEN, JSON.stringify(lanes));
		this.set({ hidden: lanes });
	}

	private set(
		next: Partial<Pick<TodoView, "opened" | "openedTask" | "hidden">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

/** The lanes hidden on the last visit; none when what was kept will not read. */
function hiddenIn(storage?: Storage): (number | null)[] {
	try {
		const kept: unknown = JSON.parse(storage?.getItem(HIDDEN) ?? "[]");
		return Array.isArray(kept)
			? kept.filter((lane) => lane === null || typeof lane === "number")
			: [];
	} catch {
		return [];
	}
}

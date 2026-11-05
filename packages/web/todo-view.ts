import type { TaskRecord } from "@splates/server/board";
import type { Snapshot } from "@splates/server/tasks";
import { Dispatcher, type Eventful } from "core/events";
import { TaskFilter } from "./task-filter";

export type TodoViewEvents = { changed: undefined };

/** What the todo list shows of a snapshot, given what has been picked. */
export interface TodosShown {
	/** Every todo, top of the list first. */
	todos: TaskRecord[];
	/** The todo open in its dialog. */
	current?: TaskRecord;
	/** The task open in its dialog. */
	task?: Snapshot["tasks"][number];
}

/** Where the lanes hidden from the board are kept between visits. */
const HIDDEN = "splates.hiddenLanes";

/**
 * The todo list's choices: which todo or task is open, which todos the board
 * is narrowed to, and which lanes it leaves out, `null` for the ungroomed Backlog tasks. `show` applies them to a
 * snapshot, which can change under them: a choice the snapshot no longer has room for
 * shows as nothing picked.
 */
export class TodoView implements Eventful<TodoViewEvents> {
	private readonly dispatcher = new Dispatcher<TodoViewEvents>();
	readonly events = this.dispatcher.events;

	opened: number | null = null;
	openedTask: string | null = null;
	hidden: number[];
	/** The only todos the board shows, by id, or null for every one. */
	only: readonly number[] | null = null;

	/** Which projects and tags the board and the queue are narrowed to. */
	readonly taskFilter: TaskFilter;

	/** `storage` keeps the hidden lanes and the filter for the next visit, when given. */
	constructor(private readonly storage?: Storage) {
		this.taskFilter = new TaskFilter(storage);
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

	openTask(name: string): void {
		// A task the page no longer lists opens from its finished record, if
		// one is kept on disk.
		this.set({ openedTask: name });
	}

	closeTask(): void {
		this.set({ openedTask: null });
	}

	/** Narrows the board to the todos in `ids`, or back to every one for null. */
	filter(ids: readonly number[] | null): void {
		this.set({ only: ids });
	}

	/** Shows lane `lane` if hidden, else hides it. */
	toggleLane(lane: number): void {
		this.hide(
			this.hidden.includes(lane)
				? this.hidden.filter((other) => other !== lane)
				: [...this.hidden, lane],
		);
	}

	/** Hides `lanes` and shows every other. */
	hide(lanes: number[]): void {
		this.storage?.setItem(HIDDEN, JSON.stringify(lanes));
		this.set({ hidden: lanes });
	}

	private set(
		next: Partial<Pick<TodoView, "opened" | "openedTask" | "hidden" | "only">>,
	): void {
		Object.assign(this, next);
		this.dispatcher.dispatch("changed");
	}
}

/** The lanes hidden on the last visit; none when what was kept will not read. */
function hiddenIn(storage?: Storage): number[] {
	try {
		const kept: unknown = JSON.parse(storage?.getItem(HIDDEN) ?? "[]");
		return Array.isArray(kept)
			? kept.filter((lane) => typeof lane === "number")
			: [];
	} catch {
		return [];
	}
}

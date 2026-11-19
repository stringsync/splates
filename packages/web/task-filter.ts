import { Dispatcher, type Eventful } from "core/events";
import { NoopStorage } from "./noop-storage";

export type TaskFilterEvents = { changed: undefined };

/** Where the filter is kept between visits. */
const KEPT = "splates.taskFilter";

/** What a filter reads of a task or todo. */
export interface Filtered {
	/** The project it changes; null for one recorded without. */
	project: string | null;
}

/**
 * Narrows the tasks the board and the queue show to the projects picked;
 * nothing picked shows every task. The choice carries over to the next visit.
 */
export class TaskFilter implements Eventful<TaskFilterEvents> {
	private readonly dispatcher = new Dispatcher<TaskFilterEvents>();
	readonly events = this.dispatcher.events;

	projects: string[];

	/** Pass `storage` to keep the choice for the next visit. */
	constructor(private readonly storage: Storage = new NoopStorage()) {
		const kept = keptIn(storage);
		this.projects = kept.projects;
	}

	/** Whether any choice narrows what is shown. */
	get active(): boolean {
		return this.projects.length > 0;
	}

	passes(item: Filtered): boolean {
		return (
			this.projects.length === 0 ||
			(item.project !== null && this.projects.includes(item.project))
		);
	}

	toggleProject(project: string): void {
		this.set({ projects: toggled(this.projects, project) });
	}

	clear(): void {
		this.set({ projects: [] });
	}

	private set(next: Partial<Pick<TaskFilter, "projects">>): void {
		Object.assign(this, next);
		this.storage.setItem(KEPT, JSON.stringify({ projects: this.projects }));
		this.dispatcher.dispatch("changed");
	}
}

function toggled(list: string[], one: string): string[] {
	return list.includes(one)
		? list.filter((each) => each !== one)
		: [...list, one];
}

/** The choice kept on the last visit; none when what was kept will not read. */
function keptIn(storage: Storage): { projects: string[] } {
	try {
		const kept: unknown = JSON.parse(storage.getItem(KEPT) ?? "{}");
		const strings = (value: unknown): string[] =>
			Array.isArray(value)
				? value.filter((each): each is string => typeof each === "string")
				: [];
		const record = (kept ?? {}) as Record<string, unknown>;
		return { projects: strings(record.projects) };
	} catch {
		return { projects: [] };
	}
}

/** The projects tasks change, with any picked so they can be undone. */
export function projectOptions(
	items: readonly Filtered[],
	picked: readonly string[],
): string[] {
	const used = items.flatMap((item) =>
		item.project === null ? [] : [item.project],
	);
	return [...new Set([...used, ...picked])].sort();
}

import { Dispatcher, type Eventful } from "core/events";

export type TaskFilterEvents = { changed: undefined };

/** Where the filter is kept between visits. */
const KEPT = "splates.taskFilter";

/** What a filter reads of a task or todo. */
export interface Filtered {
	/** The project it changes; null for one recorded without. */
	project: string | null;
	tags: readonly string[];
}

/**
 * Which tasks the board and the queue show: those of any project picked and
 * carrying any tag picked. Nothing picked of a kind lets every task through.
 * Kept per person, so the next visit starts where this one left off.
 */
export class TaskFilter implements Eventful<TaskFilterEvents> {
	private readonly dispatcher = new Dispatcher<TaskFilterEvents>();
	readonly events = this.dispatcher.events;

	projects: string[];
	tags: string[];

	/** `storage` keeps the choice for the next visit, when given. */
	constructor(private readonly storage?: Storage) {
		const kept = keptIn(storage);
		this.projects = kept.projects;
		this.tags = kept.tags;
	}

	/** Whether any choice narrows what is shown. */
	get active(): boolean {
		return this.projects.length > 0 || this.tags.length > 0;
	}

	passes(item: Filtered): boolean {
		return (
			(this.projects.length === 0 ||
				(item.project !== null && this.projects.includes(item.project))) &&
			(this.tags.length === 0 ||
				item.tags.some((tag) => this.tags.includes(tag)))
		);
	}

	toggleProject(project: string): void {
		this.set({ projects: toggled(this.projects, project) });
	}

	toggleTag(tag: string): void {
		this.set({ tags: toggled(this.tags, tag) });
	}

	/** Narrows to these tags alone, as a click on a tag chip does. */
	onlyTags(tags: string[]): void {
		this.set({ tags });
	}

	clear(): void {
		this.set({ projects: [], tags: [] });
	}

	private set(next: Partial<Pick<TaskFilter, "projects" | "tags">>): void {
		Object.assign(this, next);
		this.storage?.setItem(
			KEPT,
			JSON.stringify({ projects: this.projects, tags: this.tags }),
		);
		this.dispatcher.dispatch("changed");
	}
}

function toggled(list: string[], one: string): string[] {
	return list.includes(one)
		? list.filter((each) => each !== one)
		: [...list, one];
}

/** The choice kept on the last visit; none when what was kept will not read. */
function keptIn(storage?: Storage): { projects: string[]; tags: string[] } {
	try {
		const kept: unknown = JSON.parse(storage?.getItem(KEPT) ?? "{}");
		const strings = (value: unknown): string[] =>
			Array.isArray(value)
				? value.filter((each): each is string => typeof each === "string")
				: [];
		const record = (kept ?? {}) as Record<string, unknown>;
		return { projects: strings(record.projects), tags: strings(record.tags) };
	} catch {
		return { projects: [], tags: [] };
	}
}

/**
 * The tags to offer: those `splates.config.ts` allows when it lists them,
 * else those in use, with any picked that neither has so they can be undone.
 */
export function tagOptions(
	allowed: readonly string[] | undefined,
	items: readonly Filtered[],
	picked: readonly string[],
): string[] {
	const base = allowed ?? items.flatMap((item) => item.tags);
	return [...new Set([...base, ...picked])].sort();
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

import type { AutomationRow, Hook, Trigger } from "@splates/server/hooks";
import { Dispatcher, type Eventful } from "core/events";
import {
	addAutomation,
	editAutomation,
	pauseAutomation,
	automations as readAutomations,
	removeAutomation,
	runAutomation,
} from "./automations-api";
import { refusalOf } from "./refusal";

/** A subscription and the project it belongs to. */
export interface Subscribed {
	project: string;
	row: AutomationRow;
}

export type SubscriptionBookEvents = { changed: undefined };

/** How the book reaches each project's automations; the page's api by default. */
export interface ProjectAutomationsApi {
	read: (project: string) => Promise<AutomationRow[]>;
	add: (
		project: string,
		trigger: Trigger,
		hook: Hook,
		name: string,
	) => Promise<AutomationRow[]>;
	edit: (
		project: string,
		id: string,
		trigger: Trigger,
		hook: Hook,
		name: string,
	) => Promise<AutomationRow[]>;
	remove: (project: string, id: string) => Promise<AutomationRow[]>;
	pause: (
		project: string,
		id: string,
		paused: boolean,
	) => Promise<AutomationRow[]>;
	run: (project: string, id: string) => Promise<AutomationRow[]>;
}

const API: ProjectAutomationsApi = {
	read: (project) => readAutomations(project),
	add: (project, trigger, hook, name) =>
		addAutomation(trigger, hook, name, project),
	edit: (project, id, trigger, hook, name) =>
		editAutomation(id, trigger, hook, name, project),
	remove: (project, id) => removeAutomation(id, project),
	pause: (project, id, paused) => pauseAutomation(id, paused, project),
	run: (project, id) => runAutomation(id, project),
};

/**
 * The subscriptions of every project, for a list that spans them. `load`
 * the project slugs, read `all`, and pause, remove, add or edit one in its
 * own project; a project that cannot be read is left out and said in
 * `refusal`.
 */
export class SubscriptionBook implements Eventful<SubscriptionBookEvents> {
	private readonly dispatcher = new Dispatcher<SubscriptionBookEvents>();
	readonly events = this.dispatcher.events;

	/** The last read or change refused, in a line, or null. */
	refusal: string | null = null;
	/** Whether a read has finished, even for none. */
	read = false;

	readonly #rows = new Map<string, AutomationRow[]>();

	constructor(private readonly api: ProjectAutomationsApi = API) {}

	/** Every project's rows, in the order of `projects`. */
	get all(): Subscribed[] {
		return [...this.#rows].flatMap(([project, rows]) =>
			rows.map((row) => ({ project, row })),
		);
	}

	/** Reads each of `projects`, keeping what the ones that answer say. */
	async load(projects: readonly string[]): Promise<void> {
		const settled = await Promise.allSettled(
			projects.map((each) => this.api.read(each)),
		);
		let failed: unknown = null;
		for (const [index, result] of settled.entries()) {
			const project = projects[index] as string;
			if (result.status === "fulfilled") {
				this.#rows.set(project, result.value);
			} else {
				failed = result.reason;
			}
		}
		for (const project of [...this.#rows.keys()]) {
			if (!projects.includes(project)) {
				this.#rows.delete(project);
			}
		}
		this.read = true;
		this.refusal = failed === null ? null : refusalOf("Not read", failed);
		this.dispatcher.dispatch("changed");
	}

	pause(
		project: string,
		row: AutomationRow,
		paused: boolean,
	): Promise<boolean> {
		return this.#change(project, paused ? "Not paused" : "Not resumed", () =>
			this.api.pause(project, row.id, paused),
		);
	}

	/** Runs one now; its run is listed once the server answers. */
	run(project: string, row: AutomationRow): Promise<boolean> {
		return this.#change(project, "Not run", () =>
			this.api.run(project, row.id),
		);
	}

	remove(project: string, row: AutomationRow): Promise<boolean> {
		return this.#change(project, "Not removed", () =>
			this.api.remove(project, row.id),
		);
	}

	add(
		project: string,
		trigger: Trigger,
		hook: Hook,
		name = "",
	): Promise<boolean> {
		return this.#change(project, "Not added", () =>
			this.api.add(project, trigger, hook, name),
		);
	}

	edit(
		project: string,
		row: AutomationRow,
		trigger: Trigger,
		hook: Hook,
		name = "",
	): Promise<boolean> {
		return this.#change(project, "Not saved", () =>
			this.api.edit(project, row.id, trigger, hook, name),
		);
	}

	async #change(
		project: string,
		title: string,
		write: () => Promise<AutomationRow[]>,
	): Promise<boolean> {
		try {
			this.#rows.set(project, await write());
			this.refusal = null;
			this.dispatcher.dispatch("changed");
			return true;
		} catch (error) {
			await this.api
				.read(project)
				.then((rows) => this.#rows.set(project, rows))
				.catch(() => {});
			this.refusal = refusalOf(title, error);
			this.dispatcher.dispatch("changed");
			return false;
		}
	}
}

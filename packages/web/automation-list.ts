import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	addAutomation,
	pauseAutomation,
	automations as readAutomations,
	removeAutomation,
} from "./automations-api";
import { refusalOf } from "./refusal";

export type AutomationListEvents = { changed: undefined };

/** How the list reaches the server; the page's api by default. */
export interface AutomationsApi {
	read: () => Promise<AutomationRow[]>;
	add: (trigger: Trigger, hook: Hook) => Promise<AutomationRow[]>;
	remove: (id: string) => Promise<AutomationRow[]>;
	pause: (id: string, paused: boolean) => Promise<AutomationRow[]>;
}

const API: AutomationsApi = {
	read: readAutomations,
	add: addAutomation,
	remove: removeAutomation,
	pause: pauseAutomation,
};

/**
 * The automations the Automations page lists. Each change shows at once,
 * then takes what the server answers; a refusal is said, and the list read
 * again, so it shows what stands.
 */
export class AutomationList implements Eventful<AutomationListEvents> {
	private readonly dispatcher = new Dispatcher<AutomationListEvents>();
	readonly events = this.dispatcher.events;

	/** Every automation, or null until the first read. */
	rows: AutomationRow[] | null = null;
	/** The last change refused, in a line, or null. */
	refusal: string | null = null;

	constructor(private readonly api: AutomationsApi = API) {}

	/** The person's own, which they pause and remove here. */
	get own(): AutomationRow[] {
		return this.rows?.filter((each) => each.source === undefined) ?? [];
	}

	/** The `on` commands splates.config.ts checks in. */
	get checkedIn(): AutomationRow[] {
		return this.rows?.filter((each) => each.source === "config") ?? [];
	}

	/** Those splates itself sets, from Setup. */
	get builtIn(): AutomationRow[] {
		return this.rows?.filter((each) => each.source === "builtin") ?? [];
	}

	async read(): Promise<void> {
		try {
			this.#set(await this.api.read());
		} catch (error) {
			this.#refuse("Not read", error);
		}
	}

	pause(row: AutomationRow, paused: boolean): Promise<boolean> {
		return this.#change(
			paused ? "Not paused" : "Not resumed",
			(rows) =>
				rows.map((each) => (each.id === row.id ? { ...each, paused } : each)),
			() => this.api.pause(row.id, paused),
		);
	}

	remove(row: AutomationRow): Promise<boolean> {
		return this.#change(
			"Not removed",
			(rows) => rows.filter((each) => each.id !== row.id),
			() => this.api.remove(row.id),
		);
	}

	/** Adds one, shown as being added until the server numbers it. */
	add(trigger: Trigger, hook: Hook): Promise<boolean> {
		return this.#change(
			"Not added",
			(rows) => [
				...rows,
				{
					id: "",
					trigger,
					hook,
					createdAt: new Date().toISOString(),
					when: "",
					does: "",
					runs: [],
				},
			],
			() => this.api.add(trigger, hook),
		);
	}

	async #change(
		title: string,
		expected: (rows: AutomationRow[]) => AutomationRow[],
		write: () => Promise<AutomationRow[]>,
	): Promise<boolean> {
		if (this.rows !== null) {
			this.rows = expected(this.rows);
			this.dispatcher.dispatch("changed");
		}
		try {
			this.#set(await write());
			return true;
		} catch (error) {
			await this.read();
			this.#refuse(title, error);
			return false;
		}
	}

	#set(rows: AutomationRow[]): void {
		this.rows = rows;
		this.refusal = null;
		this.dispatcher.dispatch("changed");
	}

	#refuse(title: string, error: unknown): void {
		this.refusal = refusalOf(title, error);
		this.dispatcher.dispatch("changed");
	}
}

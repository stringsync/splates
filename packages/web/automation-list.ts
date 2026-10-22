import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import {
	GARDENER_AUTOMATION,
	GROOMER_AUTOMATION,
	GROOMER_TRIGGER,
} from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	addAutomation,
	editAutomation,
	gardenerAutomation,
	groomAutomation,
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
	edit: (id: string, trigger: Trigger, hook: Hook) => Promise<AutomationRow[]>;
	remove: (id: string) => Promise<AutomationRow[]>;
	pause: (id: string, paused: boolean) => Promise<AutomationRow[]>;
	groom: (pick: AgentPick) => Promise<AutomationRow[]>;
	gardener: (
		pick: AgentPick,
		schedule: GardenerSchedule,
	) => Promise<AutomationRow[]>;
}

/** When the notes gardener runs: every so often, or on a cron line. */
export type GardenerSchedule = { every: string } | { cron: string };

const API: AutomationsApi = {
	read: readAutomations,
	add: addAutomation,
	edit: editAutomation,
	remove: removeAutomation,
	pause: pauseAutomation,
	groom: groomAutomation,
	gardener: gardenerAutomation,
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

	/** The person's own, which they edit, pause and remove here. */
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

	/** The groomer, or null while it is off. */
	get groomer(): AutomationRow | null {
		return this.rows?.find((each) => each.id === GROOMER_AUTOMATION) ?? null;
	}

	/** The notes gardener, or null while it is off. */
	get notesGardener(): AutomationRow | null {
		return this.rows?.find((each) => each.id === GARDENER_AUTOMATION) ?? null;
	}

	async read(): Promise<void> {
		if (this.rows === null && this.refusal !== null) {
			// Read again after the first read failed: the page says it is reading.
			this.refusal = null;
			this.dispatcher.dispatch("changed");
		}
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

	/** Edits one, shown as being saved until the server says what it now is. */
	edit(row: AutomationRow, trigger: Trigger, hook: Hook): Promise<boolean> {
		return this.#change(
			"Not saved",
			(rows) =>
				rows.map((each) =>
					each.id === row.id
						? { ...each, trigger, hook, when: "", does: "" }
						: each,
				),
			() => this.api.edit(row.id, trigger, hook),
		);
	}

	/**
	 * Sets the agent the groomer runs as, turning it on when it is off, shown
	 * as being saved until the server says what it now is.
	 */
	groom(pick: AgentPick): Promise<boolean> {
		const hook: Hook = { kind: "groom", ...pick };
		return this.#change(
			"Not saved",
			(rows) =>
				rows.some((each) => each.id === GROOMER_AUTOMATION)
					? rows.map((each) =>
							each.id === GROOMER_AUTOMATION
								? { ...each, hook, when: "", does: "" }
								: each,
						)
					: [
							...rows,
							{
								id: GROOMER_AUTOMATION,
								trigger: GROOMER_TRIGGER,
								hook,
								createdAt: new Date().toISOString(),
								source: "builtin",
								when: "",
								does: "",
								runs: [],
							},
						],
			() => this.api.groom(pick),
		);
	}

	/**
	 * Sets the agent the notes gardener runs as and when, turning it on when it
	 * is off, shown as being saved until the server says what it now is.
	 */
	gardener(pick: AgentPick, schedule: GardenerSchedule): Promise<boolean> {
		const hook: Hook = { kind: "garden", ...pick };
		return this.#change(
			"Not saved",
			(rows) =>
				rows.some((each) => each.id === GARDENER_AUTOMATION)
					? rows.map((each) =>
							each.id === GARDENER_AUTOMATION
								? { ...each, trigger: schedule, hook, when: "", does: "" }
								: each,
						)
					: [
							...rows,
							{
								id: GARDENER_AUTOMATION,
								trigger: schedule,
								hook,
								createdAt: new Date().toISOString(),
								source: "builtin",
								when: "",
								does: "",
								runs: [],
							},
						],
			() => this.api.gardener(pick, schedule),
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

import type {
	AutomationRow,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import { GROOMER_AUTOMATION } from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";
import {
	addAutomation,
	editAutomation,
	groomAutomation,
	pauseAutomation,
	automations as readAutomations,
	removeAutomation,
	runAutomation,
} from "./automations-api";
import { refusalOf } from "./refusal";

/** The pending key of adds, which have no id yet. */
const ADDING = "";

/** What an add in flight was asked to set off and run. */
interface Adding {
	trigger: Trigger;
	hook: Hook;
}

export type AutomationListEvents = { changed: undefined };

/** How the list reaches the server; the page's api by default. */
export interface AutomationsApi {
	read: () => Promise<AutomationRow[]>;
	add: (trigger: Trigger, hook: Hook) => Promise<AutomationRow[]>;
	edit: (id: string, trigger: Trigger, hook: Hook) => Promise<AutomationRow[]>;
	remove: (id: string) => Promise<AutomationRow[]>;
	pause: (id: string, paused: boolean) => Promise<AutomationRow[]>;
	run: (id: string) => Promise<AutomationRow[]>;
	groom: (pick: AgentPick) => Promise<AutomationRow[]>;
}

const API: AutomationsApi = {
	read: readAutomations,
	add: addAutomation,
	edit: editAutomation,
	remove: removeAutomation,
	pause: pauseAutomation,
	run: runAutomation,
	groom: groomAutomation,
};

/**
 * The automations the Automations page lists, as the server has them. A
 * change you make shows as pending until the server answers; a refusal is
 * said, and the list shows what stands.
 */
export class AutomationList implements Eventful<AutomationListEvents> {
	private readonly dispatcher = new Dispatcher<AutomationListEvents>();
	readonly events = this.dispatcher.events;

	/** Every automation, or null until the first read. */
	rows: AutomationRow[] | null = null;
	/** The last change refused, in a line, or null. */
	refusal: string | null = null;

	/** Changes awaiting the server, counted by automation id (or ADDING). */
	readonly #pending = new Map<string, number>();
	/** The adds awaiting the server, listed as rows being added. */
	readonly #adds: Adding[] = [];

	constructor(private readonly api: AutomationsApi = API) {}

	/** The person's own, which they edit, pause and remove here. */
	get own(): AutomationRow[] {
		const own = this.rows?.filter((each) => each.source === undefined) ?? [];
		// Rows being added come last, unnumbered and unlabeled until the server answers.
		return [
			...own,
			...this.#adds.map(({ trigger, hook }) => ({
				id: ADDING,
				trigger,
				hook,
				createdAt: "",
				when: "",
				does: "",
				runs: [],
			})),
		];
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
		return this.#change(paused ? "Not paused" : "Not resumed", row.id, () =>
			this.api.pause(row.id, paused),
		);
	}

	/** Runs one now; its run is listed once the server answers. */
	run(row: AutomationRow): Promise<boolean> {
		return this.#change("Not run", row.id, () => this.api.run(row.id));
	}

	remove(row: AutomationRow): Promise<boolean> {
		return this.#change("Not removed", row.id, () => this.api.remove(row.id));
	}

	/** Adds one; it lists as "Adding…" until the server numbers it. */
	add(trigger: Trigger, hook: Hook): Promise<boolean> {
		const adding: Adding = { trigger, hook };
		this.#adds.push(adding);
		return this.#change(
			"Not added",
			ADDING,
			() => this.api.add(trigger, hook),
			() => this.#adds.splice(this.#adds.indexOf(adding), 1),
		);
	}

	/** Edits one, held pending until the server says what it now is. */
	edit(row: AutomationRow, trigger: Trigger, hook: Hook): Promise<boolean> {
		return this.#change("Not saved", row.id, () =>
			this.api.edit(row.id, trigger, hook),
		);
	}

	/**
	 * Sets the agent the groomer runs as, turning it on when it is off, held
	 * pending until the server says what it now is.
	 */
	groom(pick: AgentPick): Promise<boolean> {
		return this.#change("Not saved", GROOMER_AUTOMATION, () =>
			this.api.groom(pick),
		);
	}

	/** Whether a change to the automation `id` awaits the server. */
	isPending(id: string): boolean {
		return (this.#pending.get(id) ?? 0) > 0;
	}

	async #change(
		title: string,
		key: string,
		write: () => Promise<AutomationRow[]>,
		settled: () => void = () => {},
	): Promise<boolean> {
		this.#pending.set(key, (this.#pending.get(key) ?? 0) + 1);
		this.dispatcher.dispatch("changed");
		try {
			const rows = await write();
			this.#release(key);
			settled();
			this.#set(rows);
			return true;
		} catch (error) {
			this.#release(key);
			settled();
			await this.read();
			this.#refuse(title, error);
			return false;
		}
	}

	#release(key: string): void {
		const left = (this.#pending.get(key) ?? 1) - 1;
		if (left > 0) {
			this.#pending.set(key, left);
		} else {
			this.#pending.delete(key);
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

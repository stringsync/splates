import { fail } from "../exit";
import { body } from "../server/shared";
import { hookLabel, triggerLabel } from "./commands";
import type { TaskEventName } from "./events";
import type { AutomationRun, RunStore } from "./runs";
import {
	type Automation,
	GROOMER_AUTOMATION,
	type Hook,
	type HookStore,
	stagesNamed,
	type TaskFilter,
	type Trigger,
} from "./store";

/** One automation as the Automations page lists it. */
export interface AutomationRow extends Automation {
	/** Its trigger in a few words, as `task.created in backlog`. */
	when: string;
	/** What it runs in a few words. */
	does: string;
	/** Its latest runs, the latest last. */
	runs: AutomationRun[];
}

/**
 * The routes the Automations page reads and changes the person's
 * automations through, each answering with every automation as it now
 * stands. Spread one into a project's routes.
 */
export class AutomationRoutes {
	// each handler is a property, so it can be spread
	readonly #store: HookStore;
	readonly #runs: RunStore;
	readonly #all: () => Promise<Automation[]>;
	readonly #changed: () => void;

	constructor(
		store: HookStore,
		runs: RunStore,
		/** Every automation, the project's checked-in ones too. */
		all: () => Promise<Automation[]>,
		/** Told once one is added, edited, removed, paused or resumed here. */
		changed: () => void = () => {},
	) {
		this.#store = store;
		this.#runs = runs;
		this.#all = all;
		this.#changed = changed;
	}

	readonly listAutomations = (): Promise<Response> => this.#list();

	readonly addAutomation = async (request: Request): Promise<Response> => {
		const { trigger, hook } = await body(request);
		await this.#store.add(triggerIn(trigger), hookIn(hook));
		this.#changed();
		return this.#list();
	};

	readonly editAutomation = async (request: Request): Promise<Response> => {
		const { trigger, hook } = await body(request);
		await this.#store.edit(idIn(request), triggerIn(trigger), hookIn(hook));
		this.#changed();
		return this.#list();
	};

	readonly removeAutomation = async (request: Request): Promise<Response> => {
		await this.#store.remove(idIn(request));
		this.#changed();
		return this.#list();
	};

	readonly pauseAutomation = async (request: Request): Promise<Response> => {
		await this.#store.pause(idIn(request), true);
		this.#changed();
		return this.#list();
	};

	readonly resumeAutomation = async (request: Request): Promise<Response> => {
		await this.#store.pause(idIn(request), false);
		this.#changed();
		return this.#list();
	};

	async #list(): Promise<Response> {
		const runs = await this.#runs.read();
		const rows: AutomationRow[] = (await this.#all()).map((each) => ({
			...each,
			when: triggerLabel(each.trigger),
			does: hookLabel(each.hook),
			runs: runs[each.id]?.runs ?? [],
		}));
		return Response.json({ automations: rows });
	}
}

/** The person's automation `/api/automations/<id>/...` names, or the groomer. */
function idIn(request: Request): string {
	const id = new URL(request.url).pathname.split("/")[3] ?? "";
	if (!/^\d+$/.test(id) && id !== GROOMER_AUTOMATION) {
		fail("usage", `no automation ${id}: only one of yours changes here`, {
			id,
		});
	}
	return id;
}

/** The trigger a request sent, refusing one of the wrong shape; the store checks the rest. */
function triggerIn(raw: unknown): Trigger {
	const given = (raw ?? {}) as Record<string, unknown>;
	if (typeof given.every === "string") {
		return { every: given.every };
	}
	if (typeof given.cron === "string") {
		return { cron: given.cron };
	}
	if (typeof given.event !== "string") {
		fail("usage", "say what sets it off: an event, every or cron", {});
	}
	const filter = (given.filter ?? {}) as Record<string, unknown>;
	const stages = Array.isArray(filter.stages)
		? stagesNamed(filter.stages.map(String))
		: [];
	const lanes = Array.isArray(filter.lanes)
		? filter.lanes.filter((each): each is number => Number.isInteger(each))
		: [];
	const narrowed: TaskFilter = {
		...(stages.length === 0 ? {} : { stages }),
		...(lanes.length === 0 ? {} : { lanes }),
	};
	const event = given.event as TaskEventName;
	return Object.keys(narrowed).length === 0
		? { event }
		: { event, filter: narrowed };
}

/** The hook a request sent, refusing one of the wrong shape. */
function hookIn(raw: unknown): Hook {
	const given = (raw ?? {}) as Record<string, unknown>;
	if (
		given.kind === "run" &&
		typeof given.command === "string" &&
		given.command.trim() !== ""
	) {
		return { kind: "run", command: given.command };
	}
	if (
		given.kind === "agent" &&
		typeof given.agent === "string" &&
		typeof given.prompt === "string" &&
		given.prompt.trim() !== ""
	) {
		return {
			kind: "agent",
			agent: given.agent,
			prompt: given.prompt,
			...(typeof given.model === "string" && given.model !== ""
				? { model: given.model }
				: {}),
			...(typeof given.effort === "string" && given.effort !== ""
				? { effort: given.effort }
				: {}),
		};
	}
	fail(
		"usage",
		"say what runs: an agent with a prompt, or a shell command",
		{},
	);
}

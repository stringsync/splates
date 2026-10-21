import type { TaskStage } from "../board";
import { commaList } from "../comma-list";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import type { Document, Storage } from "../storage";
import { TASK_EVENTS, type TaskEventName } from "./events";
import {
	AUDIT_AUTOMATION,
	GARDENER_AUTOMATION,
	GARDENER_TRIGGER,
} from "./garden";
import { GROOMER_AUTOMATION, GROOMER_TRIGGER } from "./groomer";
import { scheduleOf } from "./schedule";

/**
 * What runs on a trigger: an agent told of it with a prompt, or a shell
 * command.
 */
export type Hook =
	| ({ kind: "agent"; prompt: string } & AgentPick)
	| { kind: "run"; command: string }
	/** The project's groomer, told to groom the backlog, as built-in automation `groomer` runs. */
	| ({ kind: "groom" } & AgentPick)
	/** An agent told to tend the project notes, as built-in automation `notes-gardener` runs. */
	| ({ kind: "garden" } & AgentPick);

/** Which tasks an event hook fires for; a field left out matches any. */
export interface TaskFilter {
	/** The stages the task stands in. */
	stages?: TaskStage[];
	/** The lanes it is in, by number. */
	lanes?: number[];
}

/**
 * What sets an automation off: a task event, narrowed by a filter; or a
 * time, every so often (`30m`, `2h`, `1d`) or on a five-field cron.
 */
export type Trigger =
	| { event: TaskEventName; filter?: TaskFilter }
	| { every: string }
	| { cron: string };

/** One thing that runs on a trigger, as the Automations page lists it. */
export interface Automation {
	/** Its number among the person's, or a name for one splates or the project sets. */
	id: string;
	trigger: Trigger;
	hook: Hook;
	/** Set while the person has it paused: it keeps its place and runs nothing. */
	paused?: boolean;
	/** When it was set, which a schedule counts its first run from. */
	createdAt: string;
	/** When its trigger last changed: its schedule counts from then, not from a run before. */
	editedAt?: string;
	/** Where it comes from: the person, by default; the project's config, or splates itself. */
	source?: "config" | "builtin";
}

/** Each event's hooks, in the order they run: the store's form before automations. */
export type Hooks = Partial<Record<TaskEventName, Hook[]>>;

/**
 * The automations one person set for one project, in
 * `.git/splates/hooks.json`: never checked in, since an agent hook spends
 * its person's tokens. None set, nothing runs.
 */
export class HookStore {
	readonly #file: Document<unknown>;

	constructor(
		/** The project's, holding `hooks.json`. */
		storage: Storage,
	) {
		this.#file = storage.document("hooks.json");
	}

	/**
	 * Every automation set; none when the file is missing or will not parse.
	 * A file of the old form, each event's hooks, reads as one automation per
	 * hook, numbered in event order.
	 */
	async read(): Promise<Automation[]> {
		const parsed = await this.#file.read().catch(() => null);
		if (parsed === null || typeof parsed !== "object") {
			return [];
		}
		if ("automations" in parsed && Array.isArray(parsed.automations)) {
			// The groomer's trigger is splates's own, so one saved before it
			// changed wakes it as it is now; the notes audit, saved before it
			// grew into the gardener, runs as the gardener.
			return (parsed.automations as Automation[]).map((each) =>
				each.source !== "builtin"
					? each
					: each.id === GROOMER_AUTOMATION
						? { ...each, trigger: GROOMER_TRIGGER }
						: each.id === AUDIT_AUTOMATION
							? {
									...each,
									id: GARDENER_AUTOMATION,
									hook: { ...each.hook, kind: "garden" } as Hook,
								}
							: each,
			);
		}
		return fromHooks(parsed as Hooks);
	}

	/** Adds an automation of `hook` on `trigger`, numbered after the others. */
	async add(trigger: Trigger, hook: Hook): Promise<Automation> {
		checked(trigger);
		const createdAt = new Date().toISOString();
		let added: Automation | undefined;
		await this.change((automations) => {
			const last = Math.max(0, ...automations.map(({ id }) => Number(id) || 0));
			added = { id: String(last + 1), trigger, hook, createdAt };
			return [...automations, added];
		});
		return added as Automation;
	}

	/**
	 * Takes away the automation numbered `id`, or, given an event's name,
	 * every one on that event; refuses one there is none of.
	 */
	async remove(id: string): Promise<Automation[]> {
		const event = (TASK_EVENTS as readonly string[]).includes(id);
		let gone: Automation[] = [];
		await this.change((automations) => {
			// The groomer goes only by its own name, never with its event's.
			gone = automations.filter((each) =>
				event
					? "event" in each.trigger &&
						each.trigger.event === id &&
						each.source !== "builtin"
					: each.id === id,
			);
			return automations.filter((each) => !gone.includes(each));
		});
		if (gone.length === 0 && !event) {
			fail("usage", `no automation ${id}: \`splates hook list\` numbers them`, {
				id,
			});
		}
		return gone;
	}

	/**
	 * Turns the groomer on, running as `pick`, or off for null: built-in
	 * automation `groomer`, which keeps its pause through a change of pick.
	 * Its trigger and what it is told are splates's own.
	 */
	async groomer(pick: AgentPick | null): Promise<Automation | null> {
		let set: Automation | null = null;
		await this.change((automations) => {
			const was = automations.find(({ id }) => id === GROOMER_AUTOMATION);
			const rest = automations.filter((each) => each !== was);
			if (pick === null) {
				return rest;
			}
			set = {
				id: GROOMER_AUTOMATION,
				trigger: GROOMER_TRIGGER,
				hook: { kind: "groom", ...pick },
				createdAt: was?.createdAt ?? new Date().toISOString(),
				source: "builtin",
				...(was?.paused === true ? { paused: true } : {}),
			};
			return [...rest, set];
		});
		return set;
	}

	/**
	 * Turns the notes gardener on, running as `pick` on `trigger`, or off for
	 * null: built-in automation `notes-gardener`, which keeps its pause and, given
	 * no trigger, its schedule through a change of pick. What it is told is
	 * splates's own.
	 */
	async gardener(
		pick: AgentPick | null,
		trigger?: { every: string } | { cron: string },
	): Promise<Automation | null> {
		if (trigger !== undefined) {
			checked(trigger);
		}
		let set: Automation | null = null;
		await this.change((automations) => {
			const was = automations.find(({ id }) => id === GARDENER_AUTOMATION);
			const rest = automations.filter((each) => each !== was);
			if (pick === null) {
				return rest;
			}
			const kept = trigger ?? was?.trigger ?? GARDENER_TRIGGER;
			const retriggered =
				was !== undefined &&
				JSON.stringify(was.trigger) !== JSON.stringify(kept);
			set = {
				id: GARDENER_AUTOMATION,
				trigger: kept,
				hook: { kind: "garden", ...pick },
				createdAt: was?.createdAt ?? new Date().toISOString(),
				source: "builtin",
				...(retriggered
					? { editedAt: new Date().toISOString() }
					: was?.editedAt === undefined
						? {}
						: { editedAt: was.editedAt }),
				...(was?.paused === true ? { paused: true } : {}),
			};
			return [...rest, set];
		});
		return set;
	}

	/**
	 * Sets what sets the person's automation `id` off and what it runs, keeping
	 * its number, its pause and its runs; refuses one there is none of. A
	 * changed trigger is stamped, so its schedule counts from now.
	 */
	async edit(id: string, trigger: Trigger, hook: Hook): Promise<Automation> {
		checked(trigger);
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id || each.source !== undefined) {
					return each;
				}
				const retriggered =
					JSON.stringify(each.trigger) !== JSON.stringify(trigger);
				found = {
					...each,
					trigger,
					hook,
					...(retriggered ? { editedAt: new Date().toISOString() } : {}),
				};
				return found;
			}),
		);
		if (found === undefined) {
			fail(
				"usage",
				`no automation ${id}: \`splates hook list\` numbers yours`,
				{
					id,
				},
			);
		}
		return found;
	}

	/** Pauses the automation numbered `id`, or lets it run again. */
	async pause(id: string, paused: boolean): Promise<Automation> {
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id) {
					return each;
				}
				const { paused: _, ...rest } = each;
				found = paused ? { ...rest, paused } : rest;
				return found;
			}),
		);
		if (found === undefined) {
			fail("usage", `no automation ${id}: \`splates hook list\` numbers them`, {
				id,
			});
		}
		return found;
	}

	private async change(
		edit: (automations: Automation[]) => Automation[],
	): Promise<void> {
		const automations = edit(await this.read());
		await this.#file.write({ automations });
	}
}

/** The old form's hooks as automations, numbered in event order. */
export function fromHooks(
	hooks: Hooks,
	source?: Automation["source"],
): Automation[] {
	return TASK_EVENTS.flatMap((event) =>
		(hooks[event] ?? []).map((hook) => ({ event, hook })),
	).map(({ event, hook }, at) => ({
		id: source === "config" ? `config:${event}` : String(at + 1),
		trigger: { event },
		hook,
		createdAt: new Date(0).toISOString(),
		...(source === undefined ? {} : { source }),
	}));
}

/** `name` as a task event, refusing one that is none. */
export function eventNamed(name: string): TaskEventName {
	if (!(TASK_EVENTS as readonly string[]).includes(name)) {
		fail(
			"usage",
			`'${name}' is no task event: use one of ${TASK_EVENTS.join(", ")}`,
			{ event: name },
		);
	}
	return name as TaskEventName;
}

/** The stages a filter can narrow a task event to, in the order a task goes through them. */
const STAGES: readonly TaskStage[] = ["backlog", "ready", "queued", "running"];

/** `names` as task stages, refusing one that is none. */
export function stagesNamed(names: readonly string[]): TaskStage[] {
	for (const name of names) {
		if (!(STAGES as readonly string[]).includes(name)) {
			fail("usage", `'${name}' is no stage: use one of ${STAGES.join(", ")}`, {
				stage: name,
			});
		}
	}
	return names as TaskStage[];
}

/** `text` as lane numbers, comma separated, refusing what is none. */
export function lanesNamed(text: string): number[] {
	const lanes = commaList(text).map(Number);
	if (lanes.some((lane) => !Number.isInteger(lane) || lane <= 0)) {
		fail("usage", `'${text}' is no list of lane numbers`, { lane: text });
	}
	return lanes;
}

/** Refuses `trigger` when its event is none or its schedule will not read. */
function checked(trigger: Trigger): void {
	if ("event" in trigger) {
		eventNamed(trigger.event);
		stagesNamed(trigger.filter?.stages ?? []);
	} else {
		scheduleOf(trigger);
	}
}

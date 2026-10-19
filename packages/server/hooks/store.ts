import type { Fs } from "webappwiz/system";
import type { TaskStage } from "../board";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import { TASK_EVENTS, type TaskEventName } from "./events";
import { scheduleOf } from "./schedule";

/**
 * What runs on a trigger: an agent told of it with a prompt, or a shell
 * command.
 */
export type Hook =
	| ({ kind: "agent"; prompt: string } & AgentPick)
	| { kind: "run"; command: string }
	/** The project's groomer, told to groom the backlog, as built-in automation `groomer` runs. */
	| ({ kind: "groom" } & AgentPick);

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
	constructor(
		/** `.git/splates/hooks.json`, or a test's own. */
		readonly path: string,
		private readonly fs: Fs,
	) {}

	/**
	 * Every automation set; none when the file is missing or will not parse.
	 * A file of the old form, each event's hooks, reads as one automation per
	 * hook, numbered in event order.
	 */
	async read(): Promise<Automation[]> {
		const raw = await this.fs.read(this.path).catch(() => null);
		if (raw === null) {
			return [];
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return [];
		}
		if (parsed === null || typeof parsed !== "object") {
			return [];
		}
		if ("automations" in parsed && Array.isArray(parsed.automations)) {
			return parsed.automations as Automation[];
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
		const tmp = `${this.path}.${crypto.randomUUID()}.tmp`;
		await this.fs.write(
			tmp,
			`${JSON.stringify({ automations }, null, "\t")}\n`,
		);
		await this.fs.rename(tmp, this.path);
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

/** Refuses `trigger` when its event is none or its schedule will not read. */
function checked(trigger: Trigger): void {
	if ("event" in trigger) {
		eventNamed(trigger.event);
		stagesNamed(trigger.filter?.stages ?? []);
	} else {
		scheduleOf(trigger);
	}
}

/** The built-in automation the groomer runs as, once Setup turns it on. */
export const GROOMER_AUTOMATION = "groomer";

/** What wakes the groomer: a task added to the backlog, rough. */
export const GROOMER_TRIGGER: Trigger = {
	event: "task.created",
	filter: { stages: ["backlog"] },
};

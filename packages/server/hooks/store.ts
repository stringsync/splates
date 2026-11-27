// vet-ignore-file doc-comments-address-users: its comments predate the rule
// vet-ignore-file export-leads-the-file: the store follows the types it keeps
import type { TaskStage } from "../board";
import { commaList } from "../comma-list";
import { fail } from "../exit";
import type { AgentPick } from "../models";
import {
	callOf,
	parseCall,
	type SignalFunctions,
	STANDARD_SIGNAL_FUNCTIONS,
} from "../signals/call";
import type { Document, Storage } from "../storage";
import { TASK_EVENTS, type TaskEventName } from "./events";
import { runsNow } from "./now";
import { scheduleOf } from "./schedule";

/**
 * What runs on a trigger: an agent told of it with a prompt, or a shell
 * command. An agent hook that names no agent runs on Autopick, which picks
 * the agent, model and effort for each run from what it is told.
 */
export type Hook =
	| ({
			kind: "agent";
			prompt: string;
	  } & Partial<AgentPick>)
	| { kind: "run"; command: string };

/** Which tasks an event hook fires for; a field left out matches any. */
export interface TaskFilter {
	/** The stages the task stands in. */
	stages?: TaskStage[];
	/** The lanes it is in, by number. */
	lanes?: number[];
}

/**
 * What sets an automation off: a task event, narrowed by a filter; or a
 * time, every so often (`30m`, `2h`, `1d`) or on a five-field cron; or a
 * signal an agent raises. An
 * event trigger may run on only every Nth time it matches.
 */
export type Trigger =
	| {
			event: TaskEventName;
			filter?: TaskFilter;
			/** Runs on every Nth time the event matches, not each time; none or 1 for each. */
			invokes?: number;
	  }
	| { every: string }
	| { cron: string }
	/** A signal `<project>.<name>`, firing once for each raise. */
	| { signal: string };

/** One thing that runs on a trigger, as the Subscriptions tab lists it. */
export interface Automation {
	/** Its number among the person's, or a name for one splates or the project sets. */
	id: string;
	/** What the person calls it. */
	name?: string;
	trigger: Trigger;
	hook: Hook;
	/** Set while the person has it paused: it keeps its place and runs nothing. */
	paused?: boolean;
	/** Why splates paused it, as when its signal's source was removed; cleared when it resumes. */
	notice?: string;
	/** The signal function its signal calls, when one is declared, so a function the project stops declaring can be told. */
	family?: string;
	/** When a one-time clock it is set on fired, which ends it: it keeps its place and runs nothing. */
	finishedAt?: string;
	/** When it was set, which a schedule counts its first run from. */
	createdAt: string;
	/** When its trigger last changed: its schedule counts from then, not from a run before. */
	editedAt?: string;
	/** When the person last asked it to run at once, which `splates server` runs it for once. */
	requestedAt?: string;
	/** Where it comes from: the person, by default, or the project's config. */
	source?: "config";
}

/**
 * The automations one person set for one project, in
 * `.git/splates/hooks.json`: never checked in, since an agent hook spends
 * its person's tokens. None set, nothing runs.
 */
export class HookStore {
	readonly #file: Document<unknown>;
	readonly #functions: () => SignalFunctions;

	constructor(
		/** The project's, holding `hooks.json`. */
		storage: Storage,
		/** The signal functions the project declares, which a subscription may call. */
		functions: () => SignalFunctions = () => ({}),
	) {
		this.#functions = functions;
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
			// Retired notes automations remain harmless in old project records.
			const kept = (parsed.automations as Automation[]).filter(
				(each) =>
					!["notes-gardener", "notes-audit"].includes(each.id) &&
					(each.hook as { kind: string }).kind !== "garden",
			);
			return withoutBuiltIns(kept);
		}
		return fromHooks(parsed as Hooks);
	}

	/** Adds an automation of `hook` on `trigger`, numbered after the others. */
	async add(given: Trigger, hook: Hook, name?: string): Promise<Automation> {
		const trigger = checked(given, this.#functions());
		const checkedHook = hook;
		const createdAt = new Date().toISOString();
		let added: Automation | undefined;
		await this.change((automations) => {
			const last = Math.max(0, ...automations.map(({ id }) => Number(id) || 0));
			added = {
				id: String(last + 1),
				...named(name),
				trigger,
				...this.#familyOf(trigger),
				hook: checkedHook,
				createdAt,
			};
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
			gone = automations.filter((each) =>
				event
					? "event" in each.trigger && each.trigger.event === id
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
	 * Sets what sets the person's automation `id` off and what it runs, keeping
	 * its number, its pause and its runs; refuses one there is none of. A
	 * changed trigger is stamped, so its schedule counts from now, and resumes
	 * one splates paused for a removed source or one a fired clock finished.
	 */
	async edit(
		id: string,
		given: Trigger,
		hook: Hook,
		name?: string,
	): Promise<Automation> {
		const trigger = checked(given, this.#functions());
		const checkedHook = hook;
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id || each.source !== undefined) {
					return each;
				}
				const retriggered =
					JSON.stringify(each.trigger) !== JSON.stringify(trigger);
				// A new signal lifts what ended the old one: splates's pause for a removed source, or a fired clock.
				const { name: _, ...kept } = each;
				const { notice: __, finishedAt: ___, ...revived } = kept;
				const { paused: ____, ...unpaused } = revived;
				const unnamed =
					retriggered &&
					(each.notice !== undefined || each.finishedAt !== undefined)
						? unpaused
						: kept;
				const { family: _____, ...unfamilied } = unnamed;
				found = {
					...unfamilied,
					...named(name),
					trigger,
					...this.#familyOf(trigger),
					hook: checkedHook,
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

	/** The signal function `trigger`'s call names, when the project declares or splates ships one. */
	#familyOf(trigger: Trigger): { family?: string } {
		if (!("signal" in trigger)) {
			return {};
		}
		const { fn } = parseCall(trigger.signal);
		return fn in { ...this.#functions(), ...STANDARD_SIGNAL_FUNCTIONS }
			? { family: fn }
			: {};
	}

	/**
	 * Swaps the trigger of automation `id` for `trigger`, an equivalent in
	 * another form: unlike an edit it stamps nothing, so its schedule keeps
	 * counting from where it was.
	 */
	async retrigger(id: string, trigger: { signal: string }): Promise<void> {
		await this.change((automations) =>
			automations.map((each) =>
				each.id === id && each.source === undefined
					? { ...each, trigger, ...this.#familyOf(trigger) }
					: each,
			),
		);
	}

	/** Ends the automation numbered `id` as finished, as when its one-time clock fired. */
	async finish(id: string, at: string): Promise<Automation> {
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id) {
					return each;
				}
				found = { ...each, finishedAt: at };
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

	/**
	 * Pauses the automation numbered `id`, or lets it run again. A `notice`
	 * says why splates paused it; resuming clears it.
	 */
	async pause(
		id: string,
		paused: boolean,
		notice?: string,
	): Promise<Automation> {
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id) {
					return each;
				}
				const { paused: _, notice: __, ...rest } = each;
				found = paused
					? { ...rest, paused, ...(notice === undefined ? {} : { notice }) }
					: rest;
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

	/**
	 * Asks for the automation `id` to run at once, as `splates server` runs it
	 * for the request, its schedule left as it was; refuses one there is none
	 * of, or one that runs only on a task event.
	 */
	async request(id: string): Promise<Automation> {
		let found: Automation | undefined;
		await this.change((automations) =>
			automations.map((each) => {
				if (each.id !== id || !runsNow(each)) {
					return each;
				}
				found = { ...each, requestedAt: new Date().toISOString() };
				return found;
			}),
		);
		if (found === undefined) {
			const set = (await this.read()).find((each) => each.id === id);
			fail(
				"usage",
				set === undefined
					? `no automation ${id}: \`splates hook list\` numbers them`
					: `automation ${id} runs on ${"event" in set.trigger ? set.trigger.event : "its schedule"}, for that event's tasks, so it cannot run now`,
				{ id },
			);
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

/** Each event's hooks, in the order they run: the store's form before automations. */
export type Hooks = Partial<Record<TaskEventName, Hook[]>>;

/** The old form's hooks as automations, numbered in event order. */
/** `name` as the field an automation keeps it in, or nothing when blank. */
function named(name: string | undefined): { name?: string } {
	const trimmed = name?.trim() ?? "";
	return trimmed === "" ? {} : { name: trimmed };
}

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
const STAGES: readonly TaskStage[] = ["available", "queued", "running"];

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

/** `text` as a count of event matches, refusing what is none. */
export function invokesNamed(text: string): number {
	const count = Number(text);
	if (!Number.isInteger(count) || count < 1) {
		fail("usage", `'${text}' is no count: give 1 or more`, { invokes: text });
	}
	return count;
}

/** `text` as lane numbers, comma separated, Backlog being 0, refusing what is none. */
export function lanesNamed(text: string): number[] {
	const lanes = commaList(text).map(Number);
	if (lanes.some((lane) => !Number.isInteger(lane) || lane < 0)) {
		fail("usage", `'${text}' is no list of lane numbers`, { lane: text });
	}
	return lanes;
}

/** Refuses `trigger` when its event is none or its schedule will not read. */
function checked(trigger: Trigger, functions: SignalFunctions): Trigger {
	if ("signal" in trigger) {
		// A call such as `clock.in("2 days")` is kept in its canonical spelling, which is what a raise names.
		return {
			signal: callOf(trigger.signal, {
				...functions,
				...STANDARD_SIGNAL_FUNCTIONS,
			}).canonical,
		};
	}
	if ("event" in trigger) {
		eventNamed(trigger.event);
		stagesNamed(trigger.filter?.stages ?? []);
		const { invokes } = trigger;
		if (invokes !== undefined && (!Number.isInteger(invokes) || invokes < 1)) {
			fail(
				"usage",
				`'${invokes}' is no count: run on every 1st or later time`,
				{
					invokes,
				},
			);
		}
	} else {
		scheduleOf(trigger);
	}
	return trigger;
}

/** What a converted groomer is told, on each task added. */
export const GROOM_PROMPT =
	"Groom the task that was just added, as the splates skill's groom reference says for a task added to Backlog: organize it and place it in a lane, never do it.";

/**
 * Splates once ran the groomer as a built-in automation, and others. A groomer kept in an old
 * record becomes a regular agent automation on a task added, numbered after
 * the others, keeping its agent, its pause and when it was set; any other built-in is dropped.
 */
function withoutBuiltIns(automations: Automation[]): Automation[] {
	let last = Math.max(0, ...automations.map(({ id }) => Number(id) || 0));
	return automations.flatMap((each) => {
		const old = each as unknown as Record<string, unknown> & {
			source?: string;
			hook: { kind: string } & Partial<AgentPick>;
		};
		if (old.source !== "builtin") {
			return [each];
		}
		if (old.hook.kind !== "groom") {
			return [];
		}
		last += 1;
		const { agent, model, effort } = old.hook;
		const { source: _, ...rest } = old;
		return [
			{
				...rest,
				id: String(last),
				name: "Groom",
				trigger: { event: "task.created" },
				hook: {
					kind: "agent",
					prompt: GROOM_PROMPT,
					...(agent === undefined ? {} : { agent }),
					...(model === undefined ? {} : { model }),
					...(effort === undefined ? {} : { effort }),
				},
			} as Automation,
		];
	});
}

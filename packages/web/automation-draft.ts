import type { TaskStage } from "@splates/server/board";
import type { Automation, Hook, Trigger } from "@splates/server/hooks";
import type { TaskEventName } from "@splates/server/hooks/browser";
import type { AgentPick } from "@splates/server/models";
import { Dispatcher, type Eventful } from "core/events";

export type AutomationDraftEvents = { changed: undefined };

/** What sets an automation off, as the form picks it. */
export type When = "event" | "every" | "cron" | "signal";

/** The fields of the form that adds or edits an automation, as typed so far. */
export interface DraftFields {
	/** What the person calls it, or "" for no name. */
	name: string;
	when: When;
	event: TaskEventName;
	/** The stages it narrows the event to, comma separated, or "" for any. */
	stage: string;
	/** The lanes it narrows the event to, by number, comma separated, or "" for any. */
	lane: string;
	/** Run on only every Nth match of the event, or "" for each. */
	invokes: string;
	/** The interval or cron line, for a schedule. */
	schedule: string;
	kind: Hook["kind"];
	/** The agent an agent hook runs as; null for Autopick. */
	pick: AgentPick | null;
	prompt: string;
	command: string;
}

/**
 * The automation the Subscriptions tab's form is putting together, anew or
 * from one it edits: what sets it off, then what it runs, made into the
 * trigger and hook the server takes.
 */
export class AutomationDraft implements Eventful<AutomationDraftEvents> {
	private readonly dispatcher = new Dispatcher<AutomationDraftEvents>();
	readonly events = this.dispatcher.events;

	fields: DraftFields = {
		name: "",
		when: "event",
		event: "task.created",
		stage: "",
		lane: "",
		invokes: "",
		schedule: "",
		kind: "agent",
		pick: null,
		prompt: "",
		command: "",
	};

	/** A draft holding what `automation` sets off and runs, to edit it. */
	static of({ name, trigger, hook }: Automation): AutomationDraft {
		const draft = new AutomationDraft();
		const fields = { ...draft.fields, name: name ?? "" };
		if ("signal" in trigger) {
			fields.when = "signal";
			fields.schedule = trigger.signal;
		} else if ("event" in trigger) {
			fields.when = "event";
			fields.event = trigger.event;
			fields.stage = trigger.filter?.stages?.join(",") ?? "";
			fields.lane = trigger.filter?.lanes?.join(",") ?? "";
			fields.invokes =
				trigger.invokes === undefined ? "" : String(trigger.invokes);
		} else if ("every" in trigger) {
			fields.when = "every";
			fields.schedule = trigger.every;
		} else {
			fields.when = "cron";
			fields.schedule = trigger.cron;
		}
		if (hook.kind === "run") {
			fields.kind = "run";
			fields.command = hook.command;
		} else if (hook.kind === "agent") {
			const { kind, prompt, agent, ...rest } = hook;
			fields.kind = kind;
			fields.prompt = prompt;
			// No agent named runs on Autopick.
			fields.pick = agent === undefined ? null : { agent, ...rest };
		}
		draft.fields = fields;
		return draft;
	}

	set<K extends keyof DraftFields>(field: K, value: DraftFields[K]): void {
		this.fields = { ...this.fields, [field]: value };
		this.dispatcher.dispatch("changed");
	}

	/** What the form holds, as a trigger and a hook; throws what is missing. */
	made(): { trigger: Trigger; hook: Hook; name: string } {
		const {
			name,
			when,
			event,
			stage,
			lane,
			invokes,
			schedule,
			kind,
			pick,
			prompt,
			command,
		} = this.fields;
		const filter = {
			...(stage === "" ? {} : { stages: stage.split(",") as TaskStage[] }),
			...(lane === "" ? {} : { lanes: lane.split(",").map(Number) }),
		};
		const count = invokes.trim() === "" ? {} : { invokes: Number(invokes) };
		const trigger: Trigger =
			when === "event"
				? Object.keys(filter).length === 0
					? { event, ...count }
					: { event, filter, ...count }
				: when === "signal"
					? { signal: schedule.trim() }
					: when === "every"
						? { every: schedule }
						: { cron: schedule };
		const hook: Hook =
			kind === "run"
				? { kind, command }
				: { kind: "agent", prompt, ...(pick ?? {}) };
		return { trigger, hook, name: name.trim() };
	}

	/** Clears what was typed once it was added, keeping the choices. */
	added(): void {
		this.fields = {
			...this.fields,
			name: "",
			prompt: "",
			command: "",
			schedule: "",
		};
		this.dispatcher.dispatch("changed");
	}
}

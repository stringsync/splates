import type { TaskStage } from "@stringsync/splates-server/board";
import type {
	Automation,
	Hook,
	Trigger,
} from "@stringsync/splates-server/hooks";
import type { TaskEventName } from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";

export type AutomationDraftEvents = { changed: undefined };

/** What sets an automation off, as the form picks it. */
export type When = "event" | "every" | "cron";

/** The fields of the form that adds or edits an automation, as typed so far. */
export interface DraftFields {
	when: When;
	event: TaskEventName;
	/** The stages it narrows the event to, comma separated, or "" for any. */
	stage: string;
	/** The lanes it narrows the event to, by number, comma separated, or "" for any. */
	lane: string;
	/** The interval or cron line, for a schedule. */
	schedule: string;
	kind: Hook["kind"];
	pick: AgentPick | null;
	prompt: string;
	command: string;
}

/**
 * The automation the Automations page's form is putting together, anew or
 * from one it edits: what sets it off, then what it runs, made into the
 * trigger and hook the server takes.
 */
export class AutomationDraft implements Eventful<AutomationDraftEvents> {
	private readonly dispatcher = new Dispatcher<AutomationDraftEvents>();
	readonly events = this.dispatcher.events;

	fields: DraftFields = {
		when: "event",
		event: "task.created",
		stage: "",
		lane: "",
		schedule: "",
		kind: "agent",
		pick: null,
		prompt: "",
		command: "",
	};

	/** A draft holding what `automation` sets off and runs, to edit it. */
	static of({ trigger, hook }: Automation): AutomationDraft {
		const draft = new AutomationDraft();
		const fields = { ...draft.fields };
		if ("event" in trigger) {
			fields.when = "event";
			fields.event = trigger.event;
			fields.stage = trigger.filter?.stages?.join(",") ?? "";
			fields.lane = trigger.filter?.lanes?.join(",") ?? "";
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
			const { kind, prompt, ...pick } = hook;
			fields.kind = kind;
			fields.prompt = prompt;
			fields.pick = pick;
		}
		draft.fields = fields;
		return draft;
	}

	set<K extends keyof DraftFields>(field: K, value: DraftFields[K]): void {
		this.fields = { ...this.fields, [field]: value };
		this.dispatcher.dispatch("changed");
	}

	/** What the form holds, as a trigger and a hook; throws what is missing. */
	made(): { trigger: Trigger; hook: Hook } {
		const { when, event, stage, lane, schedule, kind, pick, prompt, command } =
			this.fields;
		if (kind === "agent" && pick === null) {
			throw new Error("pick the agent to run");
		}
		const filter = {
			...(stage === "" ? {} : { stages: stage.split(",") as TaskStage[] }),
			...(lane === "" ? {} : { lanes: lane.split(",").map(Number) }),
		};
		const trigger: Trigger =
			when === "event"
				? Object.keys(filter).length === 0
					? { event }
					: { event, filter }
				: when === "every"
					? { every: schedule }
					: { cron: schedule };
		const hook: Hook =
			kind === "run"
				? { kind, command }
				: { kind, prompt, ...(pick as AgentPick) };
		return { trigger, hook };
	}

	/** Clears what was typed once it was added, keeping the choices. */
	added(): void {
		this.fields = { ...this.fields, prompt: "", command: "", schedule: "" };
		this.dispatcher.dispatch("changed");
	}
}

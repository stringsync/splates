import type { TaskStage } from "@stringsync/splates-server/board";
import type { Hook, Trigger } from "@stringsync/splates-server/hooks";
import type { TaskEventName } from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher, type Eventful } from "webappwiz/events";

export type AutomationDraftEvents = { changed: undefined };

/** What sets a new automation off, as the form picks it. */
export type When = "event" | "every" | "cron";

/** The fields of the form that adds an automation, as typed so far. */
export interface DraftFields {
	when: When;
	event: TaskEventName;
	/** The stage it narrows the event to, or "" for any. */
	stage: TaskStage | "";
	/** The lane it narrows the event to, by number, or "" for any. */
	lane: string;
	/** The interval or cron line, for a schedule. */
	schedule: string;
	kind: Hook["kind"];
	pick: AgentPick | null;
	prompt: string;
	command: string;
}

/**
 * The automation the Automations page's form is putting together: what sets
 * it off, then what it runs, made into the trigger and hook the server takes.
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
			...(stage === "" ? {} : { stages: [stage] }),
			...(lane === "" ? {} : { lanes: [Number(lane)] }),
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

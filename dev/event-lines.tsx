import { makeAssistantDataUI } from "@assistant-ui/react";
import type { JSX } from "react";
import type { Action, Event } from "../events";
import { ArborEvent, type ArborEventView, type Named } from "./arbor-event";
import { useStartCard } from "./current-task";
import { useNow } from "./hooks/use-now";

/**
 * Renders a `data-event` part: something arbor did at the agent's word, as
 * the line its action draws, or nothing for an action that draws none yet.
 */
export const EventUI = makeAssistantDataUI<{
	event: Event;
	also?: Event[];
	going?: boolean;
}>({
	name: "event",
	render: ({ data }) => (
		<EventLine event={data.event} also={data.also} going={data.going} />
	),
});

/** The line `event` draws, or null for an action with none. */
export function lineOf(event: Event): ArborEventView | null {
	const line = LINES[event.action] as
		| ((each: Event) => ArborEventView | null)
		| undefined;
	return line?.(event) ?? null;
}

/**
 * How each action shows in its conversation, as a line in the look of
 * `ArborEvent`. Each slice of the Arbor events lane adds its own; an action
 * missing here, or returning null for an event, shows nothing.
 */
const LINES: {
	[A in Action]?: (event: EventOf<A>) => ArborEventView | null;
} = {
	add: (event) =>
		event.reason === null
			? {
					words: [
						"Added",
						{ kind: "task", task: event.task ?? "", goal: goalOf(event) },
					],
					at: event.at,
				}
			: { mark: "failed", words: ["Add failed", task(event)], at: event.at },
	claim: (event) =>
		event.reason === null
			? { words: ["Claimed", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Claim failed", task(event)],
					at: event.at,
				},
	"todo update": (event) =>
		event.reason === null
			? { words: ["Updated", todo(event)], at: event.at }
			: null,
	// A refused add made no todo to name, and the agent says why itself.
	"todo add": (event) =>
		event.reason === null
			? {
					words: [
						"Added",
						{ kind: "todo", id: event.todo, subject: event.subject },
					],
					at: event.at,
				}
			: null,
	// A refused lane command named no lane, and the agent says why itself.
	"lane add": (event) => laned("Started", event),
	"lane update": (event) => laned("Updated", event),
	"lane remove": (event) => laned("Removed", event),
};

/**
 * The line `event` draws with the `also` that follow it, which for a run of
 * todo updates is one line naming them all, and for a wait, the end it came
 * to, if it has yet.
 */
function lineOfRun(
	event: Event,
	also: Event[],
	going: boolean,
	now: number,
): ArborEventView | null {
	if (isWait(event)) {
		return waitLine(event, also.find(isWait) ?? null, going, now);
	}
	if (also.length === 0 || event.action !== "todo update") {
		return lineOf(event);
	}
	const todos = [event, ...also].flatMap((each) =>
		each.action === "todo update" && each.reason === null
			? [{ id: each.todo, subject: each.subject, note: noteOf(each) }]
			: [],
	);
	return { words: ["Updated", { kind: "todos", todos }], at: event.at };
}

function EventLine({
	event,
	also = [],
	going = false,
}: {
	event: Event;
	also?: Event[];
	/** Whether the turn it came in is still going. */
	going?: boolean;
}): JSX.Element | null {
	// A wait under way checks each second whether it has run past its time.
	const now = useNow(going && isWait(event) && also.length === 0);
	const view = lineOfRun(event, also, going, now);
	if (view === null) {
		return null;
	}
	return event.action === "add" && event.reason === null ? (
		<AddedLine event={event} view={view} />
	) : (
		<ArborEvent event={view} />
	);
}

/**
 * The line of a task added, which shows beside the thread, as the task it is
 * on, once it scrolls up out of sight.
 */
function AddedLine({
	event,
	view,
}: {
	event: EventOf<"add">;
	view: ArborEventView;
}): JSX.Element {
	return (
		<div ref={useStartCard({ task: event.task ?? "", goal: goalOf(event) })}>
			<ArborEvent event={view} />
		</div>
	);
}

/** What done means for the task an add made: its `--goal`, else the todos it took. */
function goalOf(event: EventOf<"add">): string {
	return event.goal ?? event.subjects?.join("\n\n") ?? "";
}

/** A lane command's line, "[verb] [lane chip]", or null once refused. */
function laned(
	verb: string,
	event: EventOf<"lane add" | "lane update" | "lane remove">,
): ArborEventView | null {
	return event.reason === null
		? {
				words: [verb, { kind: "lane", id: event.lane, name: event.name }],
				at: event.at,
			}
		: null;
}

type EventOf<A extends Action> = Extract<Event, { action: A }>;

type Wait = EventOf<"wait" | "todo wait" | "creds wait">;

function isWait(event: Event): event is Wait {
	return (
		event.action === "wait" ||
		event.action === "todo wait" ||
		event.action === "creds wait"
	);
}

/**
 * How long past its time a wait still counts as under way: its own timeout
 * logs its end within a poll, so one without an end by then was cut off.
 */
const CUT_OFF_AFTER_MS = 5000;

/**
 * A wait's line: counting down to its time while under way, gone once what
 * it waited on came, which that thing's own line says, marked when it timed
 * out or was refused, and cut off when its agent stopped before it ended.
 */
function waitLine(
	began: Wait,
	ended: Wait | null,
	going: boolean,
	now: number,
): ArborEventView | null {
	const thing = waitedOn(began);
	const at = began.at;
	const end = ended ?? (began.began === null ? null : began);
	const until = began.until ?? at;
	if (end === null) {
		return going && now <= Date.parse(until) + CUT_OFF_AFTER_MS
			? { words: ["Waiting on", thing], at, deadline: { until } }
			: { words: ["Wait cut off", thing], at };
	}
	if (end.reason === null || end.reason === "dismissed") {
		return {
			words: ["Waiting on", thing],
			at,
			deadline: { until, met: true },
		};
	}
	return {
		mark: "failed",
		words: [end.reason === "timeout" ? "Wait timed out" : "Wait failed", thing],
		at,
	};
}

/** What a wait waits on, as a chip. */
function waitedOn(event: Wait): Named {
	switch (event.action) {
		case "wait":
			return task(event);
		case "todo wait":
			return {
				kind: "todo",
				id: event.todo ?? 0,
				subject: event.subject ?? "",
			};
		case "creds wait":
			return { kind: "cred", name: event.name ?? "" };
	}
}

/** The task an event is about, as a chip. */
function task(event: Event): { kind: "task"; task: string } {
	return { kind: "task", task: event.task ?? "" };
}

type Updated = Extract<Event, { action: "todo update"; reason: null }>;

/** The todo an update is about, as a chip whose title says what changed. */
function todo(event: Updated): Named {
	return {
		kind: "todo",
		id: event.todo,
		subject: event.subject,
		note: noteOf(event),
	};
}

/** What an update changed, in words, or undefined when nothing moved. */
function noteOf(event: Updated): string | undefined {
	const { changed } = event;
	const notes = [
		changed.subject !== undefined && `new subject: ${changed.subject}`,
		changed.text && "detail rewritten",
		changed.position !== undefined && `moved to position ${changed.position}`,
		changed.lane !== undefined &&
			(changed.lane === null
				? "moved out of its lane"
				: `moved to lane ${changed.lane}`),
		changed.blocked && `blocked by ${ids(changed.blocked)}`,
		changed.unblocked && `no longer blocked by ${ids(changed.unblocked)}`,
		changed.attached && `attached ${changed.attached.join(", ")}`,
		changed.detached && `dropped ${changed.detached.join(", ")}`,
		changed.assignee !== undefined &&
			(changed.assignee === null
				? "names no agent"
				: `names ${changed.assignee.agent}${changed.assignee.model === undefined ? "" : ` (${changed.assignee.model})`}`),
	].filter((note) => typeof note === "string");
	return notes.length === 0 ? undefined : notes.join("\n");
}

function ids(todos: number[]): string {
	return todos.map((id) => `#${id}`).join(", ");
}

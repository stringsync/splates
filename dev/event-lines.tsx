import { makeAssistantDataUI } from "@assistant-ui/react";
import type { JSX } from "react";
import type { Action, Event } from "../events";
import { ArborEvent, type ArborEventView, type Named } from "./arbor-event";

/**
 * Renders a `data-event` part: something arbor did at the agent's word, as
 * the line its action draws, or nothing for an action that draws none yet.
 */
export const EventUI = makeAssistantDataUI<{ event: Event; also?: Event[] }>({
	name: "event",
	render: ({ data }) => <EventLine event={data.event} also={data.also} />,
});

/**
 * How each action shows in its conversation, as a line in the look of
 * `ArborEvent`. Each slice of the Arbor events lane adds its own; an action
 * missing here, or returning null for an event, shows nothing.
 */
const LINES: {
	[A in Action]?: (event: EventOf<A>) => ArborEventView | null;
} = {
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
};

/** The line `event` draws, or null for an action with none. */
export function lineOf(event: Event): ArborEventView | null {
	const line = LINES[event.action] as
		| ((each: Event) => ArborEventView | null)
		| undefined;
	return line?.(event) ?? null;
}

/**
 * The line `event` draws with the `also` that follow it, which for a run of
 * todo updates is one line naming them all.
 */
function lineOfRun(event: Event, also: Event[]): ArborEventView | null {
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
}: {
	event: Event;
	also?: Event[];
}): JSX.Element | null {
	const view = lineOfRun(event, also);
	return view === null ? null : <ArborEvent event={view} />;
}

type EventOf<A extends Action> = Extract<Event, { action: A }>;

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

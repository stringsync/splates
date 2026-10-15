import { makeAssistantDataUI } from "@assistant-ui/react";
import type { JSX } from "react";
import type { Action, Event } from "../events";
import { ArborEvent, type ArborEventView } from "./arbor-event";

/**
 * Renders a `data-event` part: something arbor did at the agent's word, as
 * the line its action draws, or nothing for an action that draws none yet.
 */
export const EventUI = makeAssistantDataUI<{ event: Event }>({
	name: "event",
	render: ({ data }) => <EventLine event={data.event} />,
});

/**
 * How each action shows in its conversation, as a line in the look of
 * `ArborEvent`. Each slice of the Arbor events lane adds its own; an action
 * missing here shows nothing.
 */
const LINES: { [A in Action]?: (event: EventOf<A>) => ArborEventView } = {
	claim: (event) =>
		event.reason === null
			? { words: ["Claimed", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Claim failed", task(event)],
					at: event.at,
				},
};

/** The line `event` draws, or null for an action with none. */
export function lineOf(event: Event): ArborEventView | null {
	const line = LINES[event.action] as
		| ((each: Event) => ArborEventView)
		| undefined;
	return line?.(event) ?? null;
}

function EventLine({ event }: { event: Event }): JSX.Element | null {
	const view = lineOf(event);
	return view === null ? null : <ArborEvent event={view} />;
}

type EventOf<A extends Action> = Extract<Event, { action: A }>;

/** The task an event is about, as a chip. */
function task(event: Event): { kind: "task"; task: string } {
	return { kind: "task", task: event.task ?? "" };
}

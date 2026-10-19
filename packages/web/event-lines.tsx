import { makeAssistantDataUI } from "@assistant-ui/react";
import type { Action, Event } from "@stringsync/splates-server/records";
import { isEscalation } from "@stringsync/splates-server/records/browser";
import type { JSX } from "react";
import { AddedLine } from "./added-line";
import { type Start, useStartCard } from "./current-task";
import { EscalationCard, type Written } from "./escalation-card";
import { useNow } from "./hooks/use-now";
import {
	type Named,
	SplatesEvent,
	type SplatesEventView,
	type Words,
} from "./splates-event";

/**
 * Renders a `data-event` part: something splates did at the agent's word, as
 * the line its action draws, or nothing for an action that draws none yet.
 * An escalation that went through is the one event drawn as a card, since
 * the person has to act on it, with what the agent `written` of it in that
 * turn.
 */
export const EventUI = makeAssistantDataUI<{
	event: Event;
	also?: Event[];
	going?: boolean;
	written?: Written | null;
}>({
	name: "event",
	render: ({ data }) =>
		isEscalation(data.event) ? (
			<EscalationCard event={data.event} written={data.written ?? null} />
		) : (
			<EventLine event={data.event} also={data.also} going={data.going} />
		),
});

/** The line `event` draws, or null for an action with none. */
export function lineOf(event: Event): SplatesEventView | null {
	const line = LINES[event.action] as
		| ((each: Event) => SplatesEventView | null)
		| undefined;
	return line?.(event) ?? null;
}

/**
 * How each action shows in its conversation, as a line in the look of
 * `SplatesEvent`. Each slice of the Splates events lane adds its own; an action
 * missing here, or returning null for an event, shows nothing.
 */
const LINES: {
	[A in Action]?: (event: EventOf<A>) => SplatesEventView | null;
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
	attach: (event) => {
		if (event.reason !== null) {
			return {
				mark: "failed",
				words: ["Attach failed", task(event)],
				at: event.at,
			};
		}
		const attached = filesWords("Attached", event.stored);
		const removed = filesWords("Removed", event.removed);
		// A bare `splates attach` only lists what the task holds.
		if (attached.length === 0 && removed.length === 0) {
			return null;
		}
		const words =
			attached.length === 0
				? [...removed, "from", task(event)]
				: [
						...attached,
						"to",
						task(event),
						...filesWords("and removed", event.removed),
					];
		return { words, at: event.at };
	},
	// A refused one changed nothing, and the agent says why itself.
	"artifact add": (event) =>
		event.reason === null
			? {
					words: [
						"Added",
						artifact(event),
						...(event.version === 1 ? [] : [`(v${event.version})`]),
					],
					at: event.at,
				}
			: null,
	"artifact remove": (event) =>
		event.reason === null
			? { words: ["Removed", artifact(event)], at: event.at }
			: null,
	merge: (event) =>
		event.reason === null
			? { mark: "landed", words: ["Merged", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Merge failed", task(event)],
					at: event.at,
				},
	claim: (event) =>
		event.reason === null
			? { words: ["Claimed", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Claim failed", task(event)],
					at: event.at,
				},
	remove: removed,
	handoff: (event) =>
		event.reason === null
			? {
					words: ["Handed off", { ...task(event), note: handedTo(event) }],
					at: event.at,
				}
			: {
					mark: "failed",
					words: ["Handoff failed", task(event)],
					at: event.at,
				},
	retry: (event) =>
		event.reason === null
			? { words: ["Retried", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Retry failed", task(event)],
					at: event.at,
				},
	"task update": (event) =>
		event.reason === null
			? { words: ["Updated", todo(event)], at: event.at }
			: null,
	// A refused add made no todo to name, and the agent says why itself.
	"task add": (event) =>
		event.reason === null
			? {
					words: [
						"Added",
						{ kind: "todo", id: event.number, subject: event.subject },
					],
					at: event.at,
				}
			: null,
	// A refused lane command named no lane, and the agent says why itself.
	"lane add": (event) => laned("Started", event),
	"lane update": (event) => laned("Updated", event),
	"lane remove": (event) => laned("Removed", event),
	"task take": (event) => todoLine("Took", event),
	"task release": (event) => todoLine("Released", event),
	"task remove": (event) => todoLine("Removed", event),
	"queue add": (event) => todoLine("Queued", event),
	"queue remove": (event) => todoLine("Unqueued", event),
	"creds request": (event) =>
		event.reason === null && event.asked
			? {
					words: ["Requested", { kind: "cred", name: event.name }],
					at: event.at,
				}
			: null,
	auto: (event) => (event.reason === null ? autoLine(event) : null),
	// One that went through is a card, which `EventUI` draws in its place.
	escalate: (event) =>
		event.reason === null
			? { words: ["Escalated", task(event)], at: event.at }
			: {
					mark: "failed",
					words: ["Escalate failed", task(event)],
					at: event.at,
				},
};

/**
 * What Auto pick started a task on, and what the judge found in it, or why
 * it found nothing: `Auto picked Haiku 5.5, low effort: Lookup 91%, Light
 * 80%`. Every reason shows on hover.
 */
function autoLine(event: EventOf<"auto"> & { reason: null }): SplatesEventView {
	const [picked = event.agent, ...why] = event.reasons;
	const found =
		event.signs === null
			? (why[0] ?? "no judge to ask")
			: event.signs.length === 0
				? "nothing hard in it"
				: event.signs.join(", ");
	return {
		words: [`Auto picked ${picked}: ${found}`],
		title: why.join("\n"),
		at: event.at,
	};
}

/** The line a command on todos draws, none when it was refused. */
function todoLine(
	verb: string,
	event: EventOf<
		"task take" | "task release" | "task remove" | "queue add" | "queue remove"
	>,
): SplatesEventView | null {
	return event.tasks === undefined
		? null
		: { words: [verb, todos(event.tasks)], at: event.at };
}

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
): SplatesEventView | null {
	if (isWait(event)) {
		return waitLine(event, also.find(isWait) ?? null, going, now);
	}
	if (also.length === 0 || event.action !== "task update") {
		return lineOf(event);
	}
	const todos = [event, ...also].flatMap((each) =>
		each.action === "task update" && each.reason === null
			? [{ id: each.number, subject: each.subject, note: noteOf(each) }]
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
	if (event.action === "task add" && event.reason === null) {
		return <AddedLine view={view} id={event.number} />;
	}
	const start = startOf(event);
	return start === null ? (
		<SplatesEvent event={view} />
	) : (
		<StartLine start={start} view={view} />
	);
}

/**
 * The task `event` puts this conversation on: one it claimed, or added for
 * itself. An add handed to another agent puts it on none, since that agent
 * claims it in its own conversation.
 */
function startOf(event: Event): Start | null {
	if (event.reason !== null) {
		return null;
	}
	if (event.action === "add" && event.agent === null) {
		return { task: event.task ?? "", goal: goalOf(event) };
	}
	if (event.action === "claim") {
		return { task: event.task ?? "", goal: event.goal };
	}
	return null;
}

/**
 * The line of a task the conversation took up, which shows beside the
 * thread, as the task it is on, once it scrolls up out of sight.
 */
function StartLine({
	start,
	view,
}: {
	start: Start;
	view: SplatesEventView;
}): JSX.Element {
	return (
		<div ref={useStartCard(start)}>
			<SplatesEvent event={view} />
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
): SplatesEventView | null {
	return event.reason === null
		? {
				words: [verb, { kind: "lane", id: event.lane, name: event.name }],
				at: event.at,
			}
		: null;
}

type EventOf<A extends Action> = Extract<Event, { action: A }>;

type Wait = EventOf<"wait" | "task wait" | "creds wait">;

function isWait(event: Event): event is Wait {
	return (
		event.action === "wait" ||
		event.action === "task wait" ||
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
): SplatesEventView | null {
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
		case "task wait":
			return {
				kind: "todo",
				id: event.number ?? 0,
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

/** The artifact an artifact command is about, as a chip opening the version it names. */
function artifact(
	event: EventOf<"artifact add" | "artifact remove"> & { reason: null },
): Named {
	return {
		kind: "artifact",
		conversation: event.conversation ?? "",
		name: event.name,
		version: event.version,
	};
}

/** The line of a task removed, its reason and the todos put back on its chip's hover. */
function removed(event: EventOf<"remove">): SplatesEventView {
	return event.reason === null
		? {
				words: ["Removed", { ...task(event), note: removedNote(event) }],
				at: event.at,
			}
		: { mark: "failed", words: ["Remove failed", task(event)], at: event.at };
}

/** Why a task was removed and the todos put back, for its chip's hover. */
function removedNote(event: EventOf<"remove">): string | undefined {
	const notes = [
		event.why != null && `Reason: ${event.why}`,
		...(event.released ?? []).map(
			({ id, subject }) => `Task #${id} open again: ${subject}`,
		),
	].filter((note) => typeof note === "string");
	return notes.length === 0 ? undefined : notes.join("\n");
}

type Updated = Extract<Event, { action: "task update"; reason: null }>;

{
	/** The todo an update is about, as a chip whose title says what changed. */
}
function todo(event: Updated): Named {
	return {
		kind: "todo",
		id: event.number,
		subject: event.subject,
		note: noteOf(event),
	};
}

/** Who a handoff went to, for its chip's hover. */
function handedTo(event: EventOf<"handoff"> & { reason: null }): string {
	const model = event.model === null ? "" : ` (${event.model})`;
	return `handed to ${event.agent}${model}`;
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
		changed.ready && "groomed, now ready",
	].filter((note) => typeof note === "string");
	return notes.length === 0 ? undefined : notes.join("\n");
}

function ids(todos: number[]): string {
	return todos.map((id) => `#${id}`).join(", ");
}

/** Todos as one chip: the todo itself when there is one, else a burst. */
function todos(each: readonly { id: number; subject: string }[]): Named {
	const [only] = each;
	return only !== undefined && each.length === 1
		? { kind: "todo", ...only }
		: { kind: "todos", todos: each };
}

/**
 * A verb and the files it was done to: a file chip for one, else the count,
 * since a line of several chips may not fit on one, and the task they were
 * done on says more than their names. No thumbnails, which would break the
 * one-line look.
 */
function filesWords(verb: string, paths: readonly string[]): Words {
	if (paths.length === 0) {
		return [];
	}
	return paths.length === 1
		? [verb, { kind: "file", path: paths[0] ?? "" }]
		: [`${verb} ${paths.length} files`];
}

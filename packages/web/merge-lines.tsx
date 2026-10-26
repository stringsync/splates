import type { Event } from "@stringsync/splates-server/records";
import { type JSX, useContext } from "react";
import { lineOf } from "./event-lines";
import { EndedMergeCard, LiveMergeCard, MergeCardContext } from "./merge-card";
import { MergeFailedLine } from "./merge-failed-line";
import { SplatesEvent, type SplatesEventView } from "./splates-event";

type EventOf<A extends Event["action"]> = Extract<Event, { action: A }>;
type MergeStep = EventOf<"merge queued" | "merge start">;

/** Whether `event` is a merge's first step, which its later ones fold into. */
export function isMergeStep(event: Event): event is MergeStep {
	return event.action === "merge queued" || event.action === "merge start";
}

/**
 * A merge as it goes, from its first step and the `also` folded into it: a
 * card of its steps while this conversation's task merges, folded once it
 * ends to "Merged" or "Merge failed" with its run time, opening to the steps
 * it took. Where there is no card to draw, a merge in a thread whose task is
 * gone or one from before its event kept its steps, it is lines: a "Merge
 * queued" line counting up while it waits for the premerge lock, keeping the
 * wait once it has it, then a "Merge started" line counting up while it
 * runs, which becomes "Merged" or "Merge failed" with its run time. A merge
 * that had the lock at once has only the second line. A step left without
 * an end once its turn is over was cut off: "Merge interrupted".
 */
export function MergeLines({
	first,
	also,
	going,
}: {
	first: MergeStep;
	also: Event[];
	/** Whether the turn it came in is still going. */
	going: boolean;
}): JSX.Element {
	const queued = first.action === "merge queued" ? first : null;
	const start =
		first.action === "merge start"
			? first
			: (also.find(
					(each): each is EventOf<"merge start"> =>
						each.action === "merge start",
				) ?? null);
	const end =
		also.find((each): each is EventOf<"merge"> => each.action === "merge") ??
		null;
	const card = useContext(MergeCardContext);
	const task = card?.task ?? null;
	if (end !== null && end.stepsMs !== undefined) {
		return (
			<EndedMergeCard
				end={end}
				ms={Date.parse(end.at) - Date.parse(first.at)}
			/>
		);
	}
	if (
		end === null &&
		going &&
		card !== null &&
		task !== null &&
		task.task === first.task &&
		task.mergeSteps !== null
	) {
		return <LiveMergeCard task={task} conversation={card.conversation} />;
	}
	return (
		<>
			{queued !== null && (
				<SplatesEvent
					event={queuedLine(queued, start?.at ?? end?.at ?? null, going)}
				/>
			)}
			{start !== null && <StartedLine start={start} end={end} going={going} />}
		</>
	);
}

/** The queued line: counting while it waits, the wait once it ended, at `until`. */
function queuedLine(
	queued: MergeStep,
	until: string | null,
	going: boolean,
): SplatesEventView {
	const task = { kind: "task" as const, task: queued.task ?? "" };
	if (until !== null) {
		return {
			words: [
				"Merge queued",
				task,
				`· waited ${spanOf(Date.parse(until) - Date.parse(queued.at))}`,
			],
			at: queued.at,
		};
	}
	return going
		? { words: ["Merge queued", task], at: queued.at, since: queued.at }
		: { words: ["Merge interrupted", task], at: queued.at };
}

/** The started line: counting while it runs, then how it ended and how long it ran. */
function StartedLine({
	start,
	end,
	going,
}: {
	start: MergeStep;
	end: EventOf<"merge"> | null;
	going: boolean;
}): JSX.Element {
	const task = { kind: "task" as const, task: start.task ?? "" };
	if (end === null) {
		return (
			<SplatesEvent
				event={
					going
						? { words: ["Merge started", task], at: start.at, since: start.at }
						: { words: ["Merge interrupted", task], at: start.at }
				}
			/>
		);
	}
	const ended = lineOf(end);
	const view: SplatesEventView = {
		...ended,
		words: [
			...(ended?.words ?? []),
			`in ${spanOf(Date.parse(end.at) - Date.parse(start.at))}`,
		],
		at: start.at,
	};
	return end.reason === null ? (
		<SplatesEvent event={view} />
	) : (
		<MergeFailedLine view={view} event={end} />
	);
}

/** `ms` in words, to the second: `45s`, `2m`, `1m 40s`. */
export function spanOf(ms: number): string {
	const secs = Math.max(0, Math.round(ms / 1000));
	const mins = Math.floor(secs / 60);
	const rest = secs % 60;
	if (mins === 0) {
		return `${rest}s`;
	}
	return rest === 0 ? `${mins}m` : `${mins}m ${rest}s`;
}

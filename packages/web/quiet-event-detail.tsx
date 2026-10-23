import type { Event } from "@stringsync/splates-server/records";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { AddedLine } from "./added-line";
import { AutoPickLine } from "./auto-pick-line";
import { Board } from "./board";
import { lineOf } from "./event-lines";
import { NamedChip, type SplatesEventView } from "./splates-event";
import { Stamp } from "./stamp";

/** One event in the dialog, with a time and visible detail rather than hover text. */
export function QuietEventDetail({
	event,
}: {
	event: Event;
}): JSX.Element | null {
	const board = useContext(Board);
	const view = lineOf(event);
	if (view === null || event.reason !== null) {
		return null;
	}
	const tasks =
		event.action === "lane remove"
			? event.tasks.map((id) => ({
					id,
					subject: board.todos.find((todo) => todo.id === id)?.subject ?? "",
				}))
			: event.action === "lane add" || event.action === "lane update"
				? board.todos.filter((todo) => todo.lane === event.lane)
				: [];
	const ids =
		event.action === "task add" || event.action === "task update"
			? [event.number]
			: "tasks" in event
				? event.tasks.map((task) => (typeof task === "number" ? task : task.id))
				: [];
	const detail = board.todos
		.filter((todo) => ids.includes(todo.id))
		.map((todo) =>
			[
				todo.text.split("\n").find((line) => line.trim() !== ""),
				todo.from && `Source: ${todo.from}`,
			]
				.filter(Boolean)
				.join("\n"),
		)
		.filter(Boolean);
	const files =
		event.action === "attach"
			? [
					...event.stored.map((path) => `Attached: ${path}`),
					...event.removed.map((path) => `Removed: ${path}`),
				]
			: [];
	return (
		<div className="min-w-0 text-xs wrap-anywhere">
			<Stamp at={event.at} />
			{event.action === "task add" ? (
				<AddedLine
					view={view}
					id={event.number}
					render={(each) => <DetailLine view={each} />}
				/>
			) : event.action === "auto" ? (
				<AutoPickLine event={event} details />
			) : event.action === "note read" ? (
				<p role="note" aria-label="splates">
					Read {event.path}
					{event.subagent && " by a subagent"}
				</p>
			) : (
				<DetailLine view={view} />
			)}
			{detail.map((text) => (
				<p
					key={text}
					className="mt-1 whitespace-pre-line text-muted-foreground"
				>
					{text}
				</p>
			))}
			{files.map((text) => (
				<p key={text} className="mt-1">
					{text}
				</p>
			))}
			{(event.action === "artifact add" ||
				event.action === "artifact remove") && <p>Version {event.version}</p>}
			{event.action === "add" && (
				<p>
					Handed to {event.agent}
					{event.model && ` (${event.model})`}
					{event.goal && `: ${event.goal}`}
				</p>
			)}
			{event.task !== null && event.action !== "add" && (
				<p className="text-muted-foreground">From {event.task}</p>
			)}
			{tasks.length > 0 && (
				<ul className="mt-1 flex flex-col gap-1">
					{tasks.map(({ id, subject }) => (
						<li key={id}>
							#{id} {subject}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/** Keep the event's links and action, but let every subject and change wrap in full. */
function DetailLine({ view }: { view: SplatesEventView }): JSX.Element {
	return (
		<div
			role="note"
			aria-label="splates"
			className="flex min-w-0 flex-wrap items-center gap-1.5"
		>
			{view.words.map((word, index) => {
				const key = `${index}`;
				if (typeof word === "string") {
					return <span key={key}>{word}</span>;
				}
				if (word.kind === "todos") {
					return (
						<div key={key} className="flex min-w-0 flex-col gap-1">
							{word.todos.map((todo) => (
								<NamedChip
									key={todo.id}
									named={{ kind: "todo", ...todo }}
									whole
								/>
							))}
						</div>
					);
				}
				return (
					<div key={key} className="min-w-0 max-w-full">
						<NamedChip named={word} whole />
						{"note" in word && word.note && (
							<p className="mt-1 whitespace-pre-line text-muted-foreground">
								{word.note}
							</p>
						)}
					</div>
				);
			})}
			{view.act && (
				<Button variant="outline" size="xs" onClick={view.act.run}>
					{view.act.label}
				</Button>
			)}
		</div>
	);
}

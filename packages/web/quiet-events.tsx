import type { Event } from "@stringsync/splates-server/records";
import { FilesIcon, ListTodoIcon, PackageIcon, XIcon } from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { EventLine } from "./event-lines";
import { type CountKind, countsOf } from "./quiet-counts";
import { Stamp } from "./stamp";
import { LaneIcon } from "./task-icon";

/** The most kinds of count a row shows before the rest fold into `+N more`. */
const SHOWN = 3;

const ICONS: Partial<Record<CountKind, typeof FilesIcon>> = {
	added: ListTodoIcon,
	lanes: LaneIcon,
	files: FilesIcon,
	artifacts: PackageIcon,
};

/**
 * The quiet events of a work row as muted plain counts, `3 tasks added ·
 * Uploads lane · 2 moved`, that open a dialog of them in full. Notes read and
 * Auto pick have no count, so a row with only those says how many events
 * instead, to leave a way in.
 */
export function QuietCounts({
	events,
	className,
}: {
	events: readonly Event[];
	className?: string;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	if (events.length === 0) {
		return null;
	}
	const { counts, refused } = countsOf(events);
	const shown = counts.slice(0, SHOWN);
	const more = counts.length - shown.length;
	const parts: { key: string; node: ReactNode }[] = shown.map(
		({ kind, label }) => {
			const Icon = ICONS[kind];
			return {
				key: kind,
				node: (
					<>
						{Icon && <Icon aria-hidden className="size-3 shrink-0" />}
						{label}
					</>
				),
			};
		},
	);
	if (more > 0) {
		parts.push({ key: "more", node: `+${more} more` });
	}
	if (refused > 0) {
		parts.push({
			key: "refused",
			node: (
				<>
					<XIcon aria-hidden className="size-3 shrink-0 text-destructive" />
					{refused} refused
				</>
			),
		});
	}
	if (parts.length === 0) {
		parts.push({
			key: "events",
			node: `${events.length} ${events.length === 1 ? "event" : "events"}`,
		});
	}
	return (
		<>
			<button
				type="button"
				aria-label="quiet events"
				onClick={(event) => {
					// Inside a row's summary, opening the dialog must not fold the row.
					event.preventDefault();
					setOpen(true);
				}}
				className={cn(
					"flex min-w-0 cursor-pointer flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs hover:text-foreground",
					className,
				)}
			>
				{parts.map(({ key, node }, index) => (
					<span key={key} className="inline-flex items-center gap-1">
						{index > 0 && <span aria-hidden>·</span>}
						{node}
					</span>
				))}
			</button>
			{open && (
				<Dialog open onOpenChange={setOpen}>
					<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>What it did on the side</DialogTitle>
						</DialogHeader>
						<Groups events={events} />
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

/** The groups the dialog sorts events into, and whether each folds into one line. */
const GROUPS: {
	title: string;
	has: (event: Event) => boolean;
	run?: true;
}[] = [
	{ title: "Tasks added", has: (event) => event.action === "task add" },
	{
		title: "Tasks updated",
		has: (event) => event.action === "task update",
		run: true,
	},
	{
		title: "Tasks taken and removed",
		has: (event) =>
			event.action === "task take" ||
			event.action === "task release" ||
			event.action === "task remove",
	},
	{
		title: "Queue",
		has: (event) =>
			event.action === "queue add" || event.action === "queue remove",
	},
	{
		title: "Lanes",
		has: (event) =>
			event.action === "lane add" ||
			event.action === "lane update" ||
			event.action === "lane remove",
	},
	{ title: "Files", has: (event) => event.action === "attach" },
	{
		title: "Artifacts",
		has: (event) =>
			event.action === "artifact add" || event.action === "artifact remove",
	},
	{
		title: "Notes read",
		has: (event) => event.action === "note read",
		run: true,
	},
	{ title: "Auto pick", has: (event) => event.action === "auto" },
	{ title: "Handed to another agent", has: (event) => event.action === "add" },
];

/**
 * The events by group, each group's lines as the thread draws them: an added
 * task keeps its Remove and Undo, and an Auto pick its Undo, since they live
 * in those lines. Refused ones come last, with why.
 */
function Groups({ events }: { events: readonly Event[] }): JSX.Element {
	const done = events.filter((event) => event.reason === null);
	const refused = events.filter((event) => event.reason !== null);
	return (
		<div className="flex flex-col gap-4">
			{GROUPS.map(({ title, has, run }) => {
				const each = done.filter(has);
				const [first, ...rest] = each;
				return first === undefined ? null : (
					<section key={title} aria-label={title} className="flex flex-col">
						<h3 className="font-medium text-muted-foreground text-xs">
							{title}
						</h3>
						{/* The lines are the thread's, hairlines and all; here they sit close. */}
						<div className="[&_[role=note]]:my-2">
							{run ? (
								<EventLine event={first} also={rest} />
							) : (
								each.map((event) => <EventLine key={event.id} event={event} />)
							)}
						</div>
					</section>
				);
			})}
			{refused.length > 0 && (
				<section aria-label="Refused" className="flex flex-col gap-1">
					<h3 className="font-medium text-muted-foreground text-xs">Refused</h3>
					<ul className="flex flex-col gap-1 text-xs">
						{refused.map((event) => (
							<li key={event.id} className="flex items-baseline gap-2">
								<XIcon
									aria-hidden
									className="size-3 shrink-0 translate-y-0.5 text-destructive"
								/>
								<span className="min-w-0 flex-1">
									{event.action}: {event.reason}
								</span>
								<Stamp at={event.at} />
							</li>
						))}
					</ul>
				</section>
			)}
		</div>
	);
}

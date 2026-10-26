import type { Event } from "@stringsync/splates-server/records";
import { FilesIcon, ListTodoIcon, PackageIcon, XIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#web/lib/utils.ts";
import { type CountKind, countsOf } from "./quiet-counts";
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
 * The quiet events of a work row as muted plain counts in its line, `3 tasks
 * added · Uploads lane · 2 moved`, which open with the row: its timeline shows
 * each where it happened. Auto pick has no count.
 */
export function QuietCounts({
	events,
	className,
}: {
	events: readonly Event[];
	className?: string;
}): JSX.Element | null {
	if (events.length === 0) {
		return null;
	}
	const { counts, refused } = countsOf(events);
	const shown = counts.slice(0, SHOWN - (refused > 0 ? 1 : 0));
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
	return parts.length === 0 ? null : (
		<>
			<span aria-hidden className="max-md:hidden">
				·
			</span>
			<span
				role="note"
				aria-label="quiet events"
				className={cn(
					"flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs",
					className,
				)}
			>
				{parts.map(({ key, node }, index) => (
					<span key={key} className="inline-flex items-center gap-1">
						{index > 0 && <span aria-hidden>·</span>}
						{node}
					</span>
				))}
			</span>
		</>
	);
}

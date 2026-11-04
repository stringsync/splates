import { LockIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { Column } from "./lane-column";

/** What the Queue board's own lock says, on the board and in the Boards index. */
export const QUEUE_BOARD_WHY =
	"Permanent board: it cannot be renamed, moved or deleted. Tasks show here once queued, from every board, and their cards move on their own.";

/** Marks part of the Queue board as permanent, like Backlog's lock: `why` shows on hover and is read out. */
export function PermanentLock({ why }: { why: string }): JSX.Element {
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span />}
				aria-label={why}
				className="inline-flex shrink-0 cursor-default text-muted-foreground"
			>
				<LockIcon aria-hidden className="size-3.5" />
			</TooltipTrigger>
			<TooltipContent>{why}</TooltipContent>
		</Tooltip>
	);
}

/** Draws one column of the Queue board with its title, lock and count, styled as a board's lane. */
export function QueueColumn({
	title,
	why,
	count,
	children,
}: {
	title: string;
	/** What the column's lock says: what it holds and how cards get in and out. */
	why: string;
	count: ReactNode;
	children: ReactNode;
}): JSX.Element {
	return (
		<Column label={title} drop={NO_DROP} lit={false}>
			<h3 className="flex items-center gap-1.5 px-1.5 py-1 font-medium text-sm">
				{title}
				<PermanentLock why={why} />
				<span className="text-muted-foreground text-xs tabular-nums">
					{count}
				</span>
			</h3>
			<div className="-mx-1 flex min-h-2 flex-col gap-1.5 overflow-y-auto px-1 py-0.5">
				{children}
			</div>
		</Column>
	);
}

/** A Queue column takes no drops: its cards move by their own means. */
const NO_DROP = () => {};

import { useReactive } from "@webappwiz/react";
import {
	ChevronLeftIcon,
	ChevronsRightIcon,
	EllipsisIcon,
	PanelRightCloseIcon,
	PanelRightIcon,
	SquarePenIcon,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import type { useWidgets } from "./actions";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { unnamed, useNameOf } from "./conversation-names";
import { nextWaiting, rowsOf, waitsOnYou } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { IconButton } from "./phone-inbox";
import { arriveAt, useCopiedReplies } from "./task-view";

/**
 * A conversation's header on a phone: back to the inbox, its name on one
 * line, what else waits on you, then a menu for the rest, so it stays calm
 * with each a fingertip. Where it runs is the first of its widgets.
 */
export function PhoneThreadHeader({
	conversation,
	next,
	widgets,
	busy,
	onBack,
	onNew,
}: {
	conversation: ConversationState;
	/** On to the next agent waiting on you. */
	next: ReactNode;
	/** Its widgets, which the menu shows or hides. */
	widgets: Pick<ReturnType<typeof useWidgets>, "open" | "toggle">;
	/** Whether a widget has something going, such as a command running. */
	busy: boolean;
	onBack: () => void;
	/** On to a new conversation, so several start one after another. */
	onNew: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<header className="flex h-14 shrink-0 items-center gap-1">
			<IconButton label="Back to conversations" onClick={onBack}>
				<ChevronLeftIcon />
			</IconButton>
			<h2
				className={cn(
					"min-w-0 flex-1 truncate font-semibold text-base leading-tight",
					unnamed(conversation) && "text-muted-foreground italic",
				)}
			>
				{nameOf(conversation)}
			</h2>
			{next}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							aria-label="More"
							className="relative flex size-11 shrink-0 items-center justify-center rounded-full active:bg-muted [&_svg]:size-5"
						/>
					}
				>
					<EllipsisIcon />
					{busy && !widgets.open && (
						<span
							aria-hidden
							className="absolute top-2 right-2 size-1.5 animate-pulse rounded-full bg-success"
						/>
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuItem className="h-11" onClick={onNew}>
						<SquarePenIcon />
						New conversation
					</DropdownMenuItem>
					<DropdownMenuItem className="h-11" onClick={widgets.toggle}>
						{widgets.open ? <PanelRightCloseIcon /> : <PanelRightIcon />}
						{widgets.open ? "Hide widgets" : "Show widgets"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</header>
	);
}

/**
 * How many other agents wait on you, which a tap goes on to, the next of
 * them first, as ⌥⌘M does; nothing when none does. Heads a thread, and the
 * bar of every page but the inbox, which lists them itself.
 */
export function NextWaiting({
	feed,
	drafts,
	tasks,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	drafts: Drafts;
	tasks: Details[];
	/** The conversation shown, or null on a page that shows none. */
	open: string | null;
	onOpen: (id: string) => void;
}): ReactNode {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	const rows = rowsOf(tasks, conversations);
	const others = rows.filter(
		(row) => openedBy(row) !== open && waitsOnYou(row, drafts),
	);
	if (others.length === 0) {
		return null;
	}
	return (
		<button
			type="button"
			aria-label={`Next waiting on you, of ${others.length}`}
			onClick={() => {
				const next = nextWaiting(others, drafts, open);
				if (next !== undefined) {
					arriveAt(openedBy(next));
					onOpen(openedBy(next));
				}
			}}
			className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-warning/15 px-3 font-medium text-sm text-warning active:bg-warning/25"
		>
			{others.length}
			<ChevronsRightIcon className="size-4" />
		</button>
	);
}

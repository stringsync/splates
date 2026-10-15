import { useReactive } from "@webappwiz/react";
import { ChevronLeftIcon, ChevronsRightIcon } from "lucide-react";
import type { JSX, ReactNode } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import type { ConversationFeed } from "./conversation-feed";
import { unnamed, useNameOf } from "./conversation-names";
import { nextWaiting, openedBy, rowsOf, waitsOnYou } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { IconButton } from "./phone-inbox";
import { arriveAt, useCopiedReplies } from "./task-view";

/**
 * A conversation's header on a phone: back to the inbox, its name over where
 * it runs, then what else waits on you and its widgets, each a fingertip.
 */
export function PhoneThreadHeader({
	conversation,
	where,
	next,
	widgets,
	onBack,
}: {
	conversation: ConversationState;
	/** The line under its name: its task, or one it can take up. */
	where: ReactNode;
	/** On to the next agent waiting on you. */
	next: ReactNode;
	/** The button that shows its widgets. */
	widgets: ReactNode;
	onBack: () => void;
}): JSX.Element {
	const nameOf = useNameOf();
	return (
		<header className="flex h-14 shrink-0 items-center gap-1">
			<IconButton label="Back to conversations" onClick={onBack}>
				<ChevronLeftIcon />
			</IconButton>
			<div className="flex min-w-0 flex-1 flex-col">
				<h2
					className={cn(
						"truncate font-semibold text-base leading-tight",
						unnamed(conversation) && "text-muted-foreground italic",
					)}
				>
					{nameOf(conversation)}
				</h2>
				{where}
			</div>
			{next}
			<span className="flex [&_button]:size-11 [&_svg]:size-5">{widgets}</span>
		</header>
	);
}

/**
 * How many other agents wait on you, which a tap goes on to, the next of
 * them first, as ⌥⌘M does; nothing when none does.
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
	/** The conversation shown. */
	open: string;
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

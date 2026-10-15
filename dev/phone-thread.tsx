import { useReactive } from "@webappwiz/react";
import { ChevronsRightIcon } from "lucide-react";
import type { JSX } from "react";
import type { Details } from "../show";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { nextWaiting, rowsOf, waitsOnYou } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { arriveAt, useCopiedReplies } from "./task-view";
import { BarButton } from "./top-bar";

/**
 * How many other agents wait on you, as a badge, which a tap goes on to, the
 * next of them first, as ⌥⌘M does. It keeps its place at the end of the bar
 * while none does, dimmed, so nothing beside it shifts as agents come and go.
 * Ends the bar of every page but the inbox, which lists them itself, and
 * conversations, whose way back counts them.
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
}): JSX.Element {
	const others = useWaitingElsewhere(feed, drafts, tasks, open);
	const count = others.length;
	return (
		<BarButton
			label={
				count === 0
					? "No one else waits on you"
					: `Next waiting on you, of ${count}`
			}
			disabled={count === 0}
			onClick={() => {
				const next = nextWaiting(others, drafts, open);
				if (next !== undefined) {
					arriveAt(openedBy(next));
					onOpen(openedBy(next));
				}
			}}
		>
			<ChevronsRightIcon
				className={count === 0 ? "text-muted-foreground/40" : "text-warning"}
			/>
			{count > 0 && (
				<span className="absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-semibold text-[10px] text-white leading-none ring-2 ring-background">
					{count}
				</span>
			)}
		</BarButton>
	);
}

/**
 * How many other agents wait on you, as a badge on the way back, which goes
 * to the inbox that lists them; nothing while none does.
 */
export function WaitingBadge({
	feed,
	drafts,
	tasks,
	open,
}: {
	feed: ConversationFeed;
	drafts: Drafts;
	tasks: Details[];
	open: string | null;
}): JSX.Element | null {
	const count = useWaitingElsewhere(feed, drafts, tasks, open).length;
	if (count === 0) {
		return null;
	}
	return (
		<span
			role="status"
			aria-label={`${count} waiting on you`}
			className="pointer-events-none absolute top-0.5 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-semibold text-[10px] text-white leading-none ring-2 ring-background"
		>
			{count}
		</span>
	);
}

/** The rows of the other agents that wait on you, beside `open`. */
function useWaitingElsewhere(
	feed: ConversationFeed,
	drafts: Drafts,
	tasks: Details[],
	open: string | null,
): ReturnType<typeof rowsOf> {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	return rowsOf(tasks, conversations).filter(
		(row) => openedBy(row) !== open && waitsOnYou(row, drafts),
	);
}

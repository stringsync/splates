import type { TaskRecord } from "@stringsync/splates-server/board";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import type { JSX } from "react";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { rowsOf, waitsOnYou } from "./conversation-rows";

/**
 * How many other agents wait on you, as a badge on the way out, a
 * conversation's way back or a page's menu, both of which lead to the inbox
 * that lists them; nothing while none does.
 */
export function WaitingBadge({
	feed,
	tasks,
	todos,
	open,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	todos: TaskRecord[];
	open: string | null;
}): JSX.Element | null {
	const count = useWaitingElsewhere(feed, tasks, todos, open).others.length;
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

/**
 * The rows of the other agents that wait on you, beside `open`, and the
 * conversations they were read from.
 */
function useWaitingElsewhere(
	feed: ConversationFeed,
	tasks: Details[],
	todos: readonly TaskRecord[],
	open: string | null,
): { others: ReturnType<typeof rowsOf>; conversations: ConversationState[] } {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const others = rowsOf(tasks, conversations, todos).filter(
		(row) => openedBy(row) !== open && waitsOnYou(row),
	);
	return { others, conversations };
}

import { needs } from "@stringsync/splates-server/needs";
import type { Details } from "@stringsync/splates-server/show";
import { useReactive } from "@webappwiz/react";
import { type JSX, useRef, useState } from "react";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { nextWaiting, rowsOf, seenFor, waitsOnYou } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcut } from "./hooks/use-shortcut";
import { arriveAt, useCopiedReplies } from "./task-view";
import { WaitingLine } from "./waiting-line";

/**
 * A line atop the list saying how many agents wait on you, which opens the next
 * as ⌥⌘M (Ctrl+Alt+M off a Mac) does: the next one waiting, or else the next
 * merged, then unread, one, lighting the line when there is none.
 */
export function NextWaiting({
	feed,
	drafts,
	tasks,
	open,
	onOpen,
	elsewhere = 0,
	onElsewhere = () => {},
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
	/** How many agents in other projects wait on you. */
	elsewhere?: number;
	/** Opens the first of those, on its project's page. */
	onElsewhere?: () => void;
}): JSX.Element {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const held = useHeld();
	const waitingKey = useHeldKey("shortcuts.waiting");
	// Each time its shortcut finds nothing to open, for the waiting line to say so.
	const [nudges, setNudges] = useState(0);
	// The latest, for the listener below, which outlives a render.
	const next = useRef(() => {});
	next.current = () => {
		const waiting = nextWaiting(rows, drafts, conversations, open);
		// Here's waiting ones, then another project's, then here's merged or unread.
		if (
			elsewhere > 0 &&
			(waiting === undefined ||
				!waitsOnYou(waiting, drafts, conversations) ||
				openedBy(waiting) === open)
		) {
			onElsewhere();
		} else if (waiting !== undefined) {
			arriveAt(openedBy(waiting));
			onOpen(openedBy(waiting));
		} else {
			setNudges((nudges) => nudges + 1);
		}
	};
	useShortcut("shortcuts.waiting", () => next.current());

	return (
		<WaitingLine
			waiting={
				rows.filter((row) => waitsOnYou(row, drafts, conversations)).length +
				elsewhere
			}
			nudges={nudges}
			hint={held ? waitingKey : null}
			onNext={() => next.current()}
		/>
	);
}

/**
 * How many agents wait on the person: conversations, and tasks whose agents
 * run outside the page, but for those whose questions were seen or reply
 * copied.
 */
export function useWaiting(
	feed: ConversationFeed,
	drafts: Drafts,
	tasks: Details[],
): number {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	return needs({ tasks, conversations }).filter(
		({ conversation, task, need }) =>
			need.kind === "waiting" && !seenFor(drafts, conversation, task, need),
	).length;
}

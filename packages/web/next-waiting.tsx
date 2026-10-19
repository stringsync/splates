import { needs } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, useContext, useRef, useState } from "react";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import {
	flatten,
	nextWaiting,
	rowsOf,
	seenFor,
	waitsOnYou,
} from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useEverywhere } from "./everywhere-context";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcut } from "./hooks/use-shortcut";
import { InboxLine } from "./inbox-line";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { foldersOf } from "./project-folders";
import { arriveAt, useCopiedReplies } from "./task-view";

/**
 * The sidebar's Inbox, its first page, counting the agents waiting on you,
 * in every project when the feed of every project is to be had. ⌥⌘M
 * (Ctrl+Alt+M off a Mac) opens the next one waiting here, then another
 * project's, on its page, or else the next merged, then unread, one here,
 * lighting the line when there is none.
 */
export function InboxEntry({
	feed,
	drafts,
	tasks,
	here,
	open,
	onOpen,
	inbox,
	onInbox,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The project the page shows, as its snapshot has it. */
	here: { root: string; repo: string; trunk: string | null };
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
	/** Whether the inbox is the page shown. */
	inbox: boolean;
	onInbox: () => void;
}): JSX.Element {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const everywhere = useEverywhere(
		({ available, projects, tasks, conversations }) => ({
			available,
			projects,
			tasks,
			conversations,
		}),
	);
	const navigation = useContext(NavigationContext);
	// Waiting on you in other projects, each opening on its project's page.
	const others = everywhere.available
		? foldersOf(
				everywhere.projects,
				everywhere.tasks,
				everywhere.conversations,
				{ ...here, tasks, conversations },
				drafts,
			).needsYou.flatMap(({ folder, tree }) => {
				const { project } = folder;
				return folder.here || project === null
					? []
					: flatten([tree])
							.filter((row) => waitsOnYou(row, drafts, folder.conversations))
							.map((row) => newConversationUrl(project, openedBy(row)));
			})
		: [];
	const elsewhere = others.length;
	const onElsewhere = () => {
		const first = others[0];
		if (first !== undefined) {
			navigation.show(first);
		}
	};
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
		<InboxLine
			current={inbox}
			waiting={
				rows.filter((row) => waitsOnYou(row, drafts, conversations)).length +
				elsewhere
			}
			nudges={nudges}
			hint={held ? waitingKey : null}
			onOpen={onInbox}
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

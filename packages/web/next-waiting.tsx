import type { TaskRecord } from "@stringsync/splates-server/board";
import { lanesTaken } from "@stringsync/splates-server/board/browser";
import { needs } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	type JSX,
	useCallback,
	useContext,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { arriveAt } from "./arrivals";
import { openedBy } from "./conversation-address";
import type { ConversationFeed } from "./conversation-feed";
import { conversationIndex, useConversationIndex } from "./conversation-index";
import { flatten, nextWaiting, rowsOf, waitsOnYou } from "./conversation-rows";
import { useEverywhere } from "./everywhere-context";
import { useHeld } from "./hooks/use-held";
import { useHeldKey, useShortcut } from "./hooks/use-shortcut";
import { NavigationContext } from "./navigation";
import { newConversationUrl } from "./new-conversation-project";
import { foldersOf } from "./project-folders";
import { WaitingLine } from "./waiting-line";

/** What the sidebar's waiting line is given. */
type Waiting = {
	feed: ConversationFeed;
	tasks: Details[];
	/** The project the page shows, as its snapshot has it. */
	here: { root: string; repo: string; trunk: string | null };
};

/**
 * A line atop the sidebar's agents saying how many wait on you, in every
 * project when the feed of every project is to be had, which opens the next
 * as ⌥⌘M (Ctrl+Alt+M off a Mac) does: the next one waiting here, then another
 * project's, on its page, or else the next merged, then unread, one here,
 * lighting the line when there is none. Here, one on the open one's lane
 * comes first.
 */
export function NextWaiting({
	open,
	onOpen,
	todos,
	...given
}: Waiting & {
	/** The board's tasks, to tell which lane each agent at work is on. */
	todos: TaskRecord[];
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { rows, waiting, others } = useWaitingEverywhere(given);
	const navigation = useContext(NavigationContext);
	const held = useHeld();
	const waitingKey = useHeldKey("shortcuts.waiting");
	// Each time its shortcut finds nothing to open, for the waiting line to say so.
	const [nudges, setNudges] = useState(0);
	// The latest, for the listener below, which outlives a render.
	const next = useRef(() => {});
	next.current = () => {
		const first = nextWaiting(rows, open, lanesTaken(todos));
		const elsewhere = others[0];
		// Here's waiting ones, then another project's, then here's merged or unread.
		if (
			elsewhere !== undefined &&
			(first === undefined || !waitsOnYou(first) || openedBy(first) === open)
		) {
			navigation.show(elsewhere);
		} else if (first !== undefined) {
			arriveAt(openedBy(first));
			onOpen(openedBy(first));
		} else {
			setNudges((nudges) => nudges + 1);
		}
	};
	useShortcut("shortcuts.waiting", () => next.current());

	return (
		<WaitingLine
			waiting={waiting}
			nudges={nudges}
			hint={held ? waitingKey : null}
			onNext={() => next.current()}
		/>
	);
}

/**
 * The agents waiting on you: how many, here and in other projects, with
 * this project's rows and the address of each other project's, on its page.
 */
function useWaitingEverywhere({ feed, tasks, here }: Waiting) {
	const conversations = useConversationIndex(feed);
	const rows = rowsOf(tasks, conversations);
	const everywhere = useEverywhere((feed) => ({
		available: feed.available,
		projects: feed.projects,
		tasks: feed.tasks,
		conversations: conversationIndex(feed),
	}));
	const others = everywhere.available
		? foldersOf(
				everywhere.projects,
				everywhere.tasks,
				everywhere.conversations,
				{ ...here, tasks, conversations },
			).flatMap((folder) => {
				const { project } = folder;
				return folder.here || project === null
					? []
					: flatten(folder.waiting)
							.filter((row) => waitsOnYou(row))
							.map((row) => newConversationUrl(project, openedBy(row)));
			})
		: [];
	const waiting = rows.filter((row) => waitsOnYou(row)).length + others.length;
	return { rows, conversations, waiting, others };
}

/**
 * How many agents wait on the person: conversations alone, as an agent
 * outside the page asks in its own session.
 */
export function useWaiting(feed: ConversationFeed, tasks: Details[]): number {
	const subscribe = useCallback(
		(changed: () => void) => feed.events.on("changed", changed),
		[feed],
	);
	const read = useCallback(
		() =>
			needs({ tasks, conversations: feed.conversations }).filter(
				({ conversation, need }) =>
					conversation !== null && need.kind === "waiting",
			).length,
		[feed, tasks],
	);
	return useSyncExternalStore(subscribe, read, read);
}

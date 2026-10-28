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
import { openForPerson } from "./deferred-body";
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
 * A line atop the sidebar's agents saying how many wait on you, counting
 * deferred tasks whose questions or outside blockers are yours to clear.
 * Click it, or press ⌥⌘M (Ctrl+Alt+M off a Mac), to open the next one
 * waiting, then the next merged, then unread; it lights when there is none.
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
	const everywhere = useWaitingEverywhere({ ...given, todos });
	const { rows, others } = everywhere;
	// A deferral with a question or outside blocker waits on you too, though no agent does.
	const waiting =
		everywhere.waiting +
		todos.filter(
			(todo) =>
				todo.takenBy === null &&
				todo.deferred !== undefined &&
				openForPerson(todo, todos).length > 0,
		).length;
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
function useWaitingEverywhere({
	feed,
	tasks,
	todos,
	here,
}: Waiting & { todos: readonly TaskRecord[] }) {
	const conversations = useConversationIndex(feed);
	const rows = rowsOf(tasks, conversations, todos);
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
				{ ...here, tasks, conversations, todos },
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
export function useWaiting(
	feed: ConversationFeed,
	tasks: Details[],
	todos?: readonly TaskRecord[],
): number {
	const subscribe = useCallback(
		(changed: () => void) => feed.events.on("changed", changed),
		[feed],
	);
	const read = useCallback(
		() =>
			needs({ tasks, conversations: feed.conversations, todos }).filter(
				({ conversation, need }) =>
					conversation !== null && need.kind === "waiting",
			).length,
		[feed, tasks, todos],
	);
	return useSyncExternalStore(subscribe, read, read);
}

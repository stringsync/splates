import type { TaskRecord } from "@splates/server/board";
import { lanesTaken } from "@splates/server/board/browser";
import type { Details } from "@splates/server/tasks";
import { useReactive } from "core/react";
import {
	type JSX,
	useCallback,
	useContext,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { ArchiveFinished } from "./archive-finished";
import { arriveAt } from "./arrivals";
import { openedBy } from "./conversation-address";
import { agentName, type ConversationFeed } from "./conversation-feed";
import { conversationIndex, useConversationIndex } from "./conversation-index";
import {
	finished,
	flatten,
	nextWaiting,
	rowsOf,
	waitsOnYou,
} from "./conversation-rows";
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
 * only agents the sidebar lists, here or in another project. Click it, or
 * press ⌥⌘M (Ctrl+Shift+M off a Mac), to open the next one waiting, then the
 * next merged, then unread; it lights when there is none. With none waiting
 * and finished conversations about, it offers to archive them in one sweep.
 */
export function NextWaiting({
	open,
	onOpen,
	todos,
	feed,
	...given
	// vet-ignore objects-over-callbacks: a React component's props, which are how React passes events
}: Waiting & {
	/** The board's tasks, to tell which lane each agent at work is on. */
	todos: TaskRecord[];
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const everywhere = useWaitingEverywhere({ ...given, feed, todos });
	const { rows, others, waiting } = everywhere;
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

	const [sweeping, setSweeping] = useState(false);
	const over = finished(rows);
	const { agents } = useReactive(feed, (each) => ({ agents: each.agents }), [
		"changed",
	]);
	return (
		<>
			<WaitingLine
				waiting={waiting}
				nudges={nudges}
				hint={held ? waitingKey : null}
				finished={over.length}
				onNext={() => next.current()}
				onSweep={() => setSweeping(true)}
			/>
			{sweeping && over.length > 0 && (
				<ArchiveFinished
					// Reset the ticks each time it opens.
					key={over.map(openedBy).join()}
					rows={over}
					agentOf={(each) => agentName(agents, each.agent)}
					open
					onClose={() => setSweeping(false)}
				/>
			)}
		</>
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
		() => rowsOf(tasks, feed.conversations, todos).filter(waitsOnYou).length,
		[feed, tasks, todos],
	);
	return useSyncExternalStore(subscribe, read, read);
}

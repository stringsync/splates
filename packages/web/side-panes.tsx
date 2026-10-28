import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { ChangesPane } from "./changes";
import { focusComposer } from "./composer-editor";
import type { ConversationFeed } from "./conversation-feed";
import { BackgroundPane, MergeOutputPane } from "./lazy-pages";
import type { Page } from "./page-route";
import { TerminalPane } from "./terminal";
import type { Terminals } from "./terminals";

/** The pane beside the page, and what opens and closes it. */
export interface SidePanes {
	/** Opens `task`'s changes beside the page, whatever the page. */
	review: (task: string) => void;
	/** Opens the output of command `background` conversation `conversation` left running. */
	watch: (conversation: string, background: string) => void;
	/** Opens what a step of a task's merge printed, from its card in `conversation`. */
	watchMerge: WatchMergeStep;
	/** Whether `conversation`'s shell has a job running. */
	shellRunning: (conversation: string) => boolean;
	/** Shows or hides `conversation`'s terminal, in place of another pane. */
	toggleTerminal: (conversation: string) => void;
	/** Shows `conversation`'s terminal, in place of another pane. */
	showTerminal: (conversation: string) => void;
	/** What the sidebar's rows under a conversation open in the pane, and which is open. */
	nested: NestedPanes;
	/** The conversation up, unless archived, whose terminal the pane can show. */
	shown: ConversationState | null;
	/** Whether a pane is open, so the page makes room for it. */
	paned: boolean;
	/** The pane open: a task's changes, a command's output, or a terminal. */
	pane: ReactNode;
}

/** What the pane shows of a conversation, by its id: its terminal or a command's output. */
export type Showing =
	| { kind: "terminal"; conversation: string }
	| { kind: "background"; conversation: string; background: string }
	| null;

/**
 * What the sidebar's rows nested under a conversation, its terminal and the
 * commands it left running, open in the pane, and which the pane shows.
 */
export interface NestedPanes {
	showing: Showing;
	/** Shows `conversation`'s terminal, in place of another pane. */
	showTerminal: (conversation: string) => void;
	watch: (conversation: string, background: string) => void;
}

/** The pane's `NestedPanes`; null where the page has no pane. */
export const NestedPanesContext = createContext<NestedPanes | null>(null);

/**
 * The pane beside the page, one at a time: the changes of the task under
 * review, the output of a background command being watched, or the terminal
 * of the conversation up.
 */
export function useSidePanes({
	snapshot,
	feed,
	available,
	page,
	open,
	terminals,
	wide,
}: {
	snapshot: Snapshot | null;
	feed: ConversationFeed;
	/** Whether `splates server` holds conversations. */
	available: boolean;
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	terminals: Terminals;
	wide: boolean;
}): SidePanes {
	// Streaming words do not change the pane's layout or terminal identity.
	useReactive(
		feed,
		(feed) => {
			const shown = feed.conversations.find(
				(each) => each.id === open && !each.archived,
			);
			return {
				id: shown?.id,
				task: shown?.task,
				title: shown?.title,
				name: shown?.name,
				background: shown?.background,
				archived: feed.conversations
					.filter((each) => each.archived)
					.map((each) => each.id)
					.join("\n"),
			};
		},
		["changed"],
	);
	const conversations = feed.conversations;
	const { terminal } = useReactive(
		terminals,
		(terminals) => ({ terminal: terminals.open }),
		["changed"],
	);
	// The task whose changes are open beside the page, whatever the page.
	const [reviewing, setReviewing] = useState<string | null>(null);
	const reviewed = snapshot?.tasks.find((task) => task.task === reviewing);
	// The background command whose output is open beside the page, by its
	// conversation, in place of that conversation's terminal.
	const [watching, setWatching] = useState<{
		conversation: string;
		background: string;
	} | null>(null);
	// The merge step whose output is open beside the page, from its card in
	// a conversation, in place of that conversation's terminal.
	const [following, setFollowing] = useState<
		Parameters<WatchMergeStep>[0] | null
	>(null);
	// Closed on a switch of project, whose tasks and conversations they are not.
	const [of, setOf] = useState(feed);
	if (of !== feed) {
		setOf(feed);
		setReviewing(null);
		setWatching(null);
		setFollowing(null);
	}
	// The conversation up, unless archived, whose terminal the pane shows when the changes
	// do not have it.
	const shown =
		available && page === "conversations"
			? (conversations.find((each) => each.id === open && !each.archived) ??
				null)
			: null;
	// An archived conversation's agent is stopped, and its shell goes with it.
	useEffect(() => {
		for (const each of conversations) {
			if (each.archived) {
				terminals.close(each.id);
			}
		}
	}, [conversations, terminals]);
	const shellRunning = useCallback(
		(conversation: string) => terminals.running(conversation),
		[terminals],
	);
	const watched =
		shown !== null && watching?.conversation === shown.id
			? (shown.background.find((each) => each.id === watching.background) ??
				null)
			: null;
	const followed =
		shown !== null && following?.conversation === shown.id ? following : null;
	const watch = useCallback(
		(conversation: string, background: string) => {
			setReviewing(null);
			setFollowing(null);
			terminals.hide();
			setWatching({ conversation, background });
		},
		[terminals],
	);
	const watchMerge = useCallback<WatchMergeStep>(
		(step) => {
			setReviewing(null);
			setWatching(null);
			terminals.hide();
			setFollowing(step);
		},
		[terminals],
	);
	const closeWatching = useCallback(() => setWatching(null), []);
	const closeFollowing = useCallback(() => setFollowing(null), []);
	const review = useCallback((task: string) => {
		setWatching(null);
		setFollowing(null);
		setReviewing(task);
	}, []);
	const showTerminal = useCallback(
		(conversation: string) => {
			setWatching(null);
			setFollowing(null);
			setReviewing(null);
			terminals.show(conversation);
		},
		[terminals],
	);
	const toggleTerminal = useCallback(
		(conversation: string) => {
			if (watched !== null || followed !== null || reviewing !== null) {
				showTerminal(conversation);
				return;
			}
			terminals.toggle(conversation);
			if (terminals.open === null) {
				focusComposer();
			}
		},
		[watched, followed, reviewing, showTerminal, terminals],
	);
	const shownId = shown?.id ?? null;
	const watchedId = watched?.id ?? null;
	const reviewedTask = reviewed?.task ?? null;
	const showing = useMemo<Showing>(
		() =>
			reviewedTask !== null || shownId === null
				? null
				: watchedId !== null
					? {
							kind: "background",
							conversation: shownId,
							background: watchedId,
						}
					: terminal === shownId
						? { kind: "terminal", conversation: shownId }
						: null,
		[reviewedTask, shownId, watchedId, terminal],
	);
	const paned =
		reviewed !== undefined ||
		watched !== null ||
		followed !== null ||
		(shown !== null && terminal === shown.id);
	const pane =
		reviewed !== undefined ? (
			<ChangesPane
				key={reviewed.task}
				task={reviewed.task}
				version={`${reviewed.ahead}:${reviewed.added}:${reviewed.removed}`}
				phone={!wide}
				onClose={() => setReviewing(null)}
			/>
		) : followed !== null ? (
			<MergeOutputPane
				key={`${followed.task}:${followed.index}`}
				task={followed.task}
				index={followed.index}
				label={followed.label}
				running={stepRunning(snapshot, followed.task, followed.index)}
				phone={!wide}
				onClose={closeFollowing}
			/>
		) : watched !== null && shown !== null ? (
			<BackgroundPane
				key={`${shown.id}:${watched.id}`}
				conversation={shown.id}
				background={watched}
				phone={!wide}
				onClose={closeWatching}
			/>
		) : (
			shown !== null &&
			terminal === shown.id && (
				// One per conversation: its projections are of that one's shell.
				<TerminalPane
					key={shown.id}
					terminals={terminals}
					conversation={shown}
					phone={!wide}
				/>
			)
		);
	return {
		review,
		watch,
		watchMerge,
		shellRunning,
		toggleTerminal,
		showTerminal,
		nested: useMemo(
			() => ({ showing, showTerminal, watch }),
			[showing, showTerminal, watch],
		),
		shown,
		paned,
		pane,
	};
}

/** Opens what step `index` of `task`'s merge printed, named `label`, from its card in `conversation`. */
export type WatchMergeStep = (step: {
	conversation: string;
	task: string;
	index: number;
	label: string;
}) => void;

/** Whether step `index` of `task`'s merge is the one under way. */
function stepRunning(
	snapshot: Snapshot | null,
	task: string,
	index: number,
): boolean {
	const steps = snapshot?.tasks.find((each) => each.task === task)?.mergeSteps
		?.steps;
	return steps !== undefined && index === steps.length - 1;
}

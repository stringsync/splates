import { useReactive } from "@webappwiz/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ConversationState } from "../conversations";
import type { Snapshot } from "../snapshot";
import { BackgroundPane } from "./background";
import { ChangesPane } from "./changes";
import { focusComposer } from "./composer-editor";
import type { Page } from "./page-route";
import { TerminalPane } from "./terminal";
import type { Terminals } from "./terminals";

/** The pane beside the page, and what opens and closes it. */
export interface SidePanes {
	/** Opens `task`'s changes beside the page, whatever the page. */
	review: (task: string) => void;
	/** Opens the output of command `background` conversation `conversation` left running. */
	watch: (conversation: string, background: string) => void;
	/** Whether `conversation`'s shell has a job running. */
	shellRunning: (conversation: string) => boolean;
	/** Shows or hides `conversation`'s terminal, in place of another pane. */
	toggleTerminal: (conversation: string) => void;
	/** The conversation up, unless archived, whose terminal the pane can show. */
	shown: ConversationState | null;
	/** Whether a pane is open, so the page makes room for it. */
	paned: boolean;
	/** The pane open: a task's changes, a command's output, or a terminal. */
	pane: ReactNode;
}

/**
 * The pane beside the page, one at a time: the changes of the task under
 * review, the output of a background command being watched, or the terminal
 * of the conversation up.
 */
export function useSidePanes({
	snapshot,
	conversations,
	available,
	page,
	open,
	terminals,
	wide,
}: {
	snapshot: Snapshot | null;
	conversations: ConversationState[];
	/** Whether `arbor dev` holds conversations. */
	available: boolean;
	page: Page;
	/** The conversation open, by its address, or null. */
	open: string | null;
	terminals: Terminals;
	wide: boolean;
}): SidePanes {
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
	const watch = useCallback(
		(conversation: string, background: string) => {
			setReviewing(null);
			terminals.hide();
			setWatching({ conversation, background });
		},
		[terminals],
	);
	const closeWatching = useCallback(() => setWatching(null), []);
	const review = useCallback((task: string) => {
		setWatching(null);
		setReviewing(task);
	}, []);
	const toggleTerminal = (conversation: string) => {
		if (watched !== null) {
			setWatching(null);
			terminals.show(conversation);
			return;
		}
		if (reviewing !== null) {
			setReviewing(null);
			terminals.show(conversation);
			return;
		}
		terminals.toggle(conversation);
		if (!terminals.open) {
			focusComposer();
		}
	};
	const paned =
		reviewed !== undefined || watched !== null || (terminal && shown !== null);
	const pane =
		reviewed !== undefined ? (
			<ChangesPane
				key={reviewed.task}
				task={reviewed.task}
				version={`${reviewed.ahead}:${reviewed.added}:${reviewed.removed}`}
				phone={!wide}
				onClose={() => setReviewing(null)}
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
			terminal &&
			shown !== null && (
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
		shellRunning,
		toggleTerminal,
		shown,
		paned,
		pane,
	};
}

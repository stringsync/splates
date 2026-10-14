import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	FileDiffIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useCallback, useContext } from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import type { Action } from "./actions";
import { ReviewChanges } from "./changes";
import { NEW } from "./conversation-address";
import { useArchive } from "./conversation-item";
import { type Drafts, newDraft } from "./drafts";
import { useShortcut, useShortcutLabel } from "./hooks/use-shortcut";
import type { Refuse } from "./refusal";
import { ToggleTerminal } from "./terminal";

/**
 * What a conversation's thread offers beside it: reviewing its task's
 * changes, its terminal, and archiving it, which ⌥⌘⌫ (Ctrl+Alt+Backspace off
 * a Mac) does too; and starting a new conversation with its agent.
 */
export function useThreadActions(
	conversation: ConversationState,
	task: Details | null,
	drafts: Drafts,
	refused: Refuse,
	onLeft: () => void,
	onOpen: (id: string) => void,
): ThreadActions {
	const { id, archived } = conversation;
	const review = useContext(ReviewChanges);
	const terminal = useContext(ToggleTerminal);
	const archive = useArchive(conversation, refused);
	const archiveKey = useShortcutLabel("shortcuts.archive");
	const terminalKey = useShortcutLabel("shortcuts.terminal");
	const actions: Action[] = [
		...(review !== null && task !== null && task.ahead !== null
			? [
					{
						label: "Review changes",
						icon: <FileDiffIcon />,
						detail: task.added !== null && (
							<span className="font-mono text-xs">
								<span className="text-success">+{task.added}</span>{" "}
								<span className="text-destructive">−{task.removed ?? 0}</span>
							</span>
						),
						run: () => review(task.task),
					},
				]
			: []),
		...(terminal !== null
			? [
					{
						label: "Terminal",
						icon: <SquareTerminalIcon />,
						detail: terminalKey !== null && <Kbd>{terminalKey}</Kbd>,
						run: () => terminal(id),
					},
				]
			: []),
		{
			label: archived ? "Unarchive" : "Archive",
			icon: archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />,
			detail:
				archived || archiveKey === null ? undefined : <Kbd>{archiveKey}</Kbd>,
			run: () => archive.file(archived ? undefined : onLeft),
		},
	];
	// Already archived, the key does nothing.
	const fileByKey = () => {
		if (!archived) {
			archive.file(onLeft);
		}
	};
	useShortcut("shortcuts.archive", fileByKey);
	// The new conversation screen, with this one's agent picked and `text`
	// typed ahead of anything already waiting there.
	const startNew = useCallback(
		(text: string) => {
			const key = newDraft(new URLSearchParams(location.search).get("project"));
			const kept = drafts.read(key);
			drafts.write(key, kept.trim() === "" ? text : `${text}\n\n${kept}`);
			onOpen(`${NEW}/${conversation.agent}`);
		},
		[drafts, onOpen, conversation.agent],
	);
	return { actions, archive, startNew };
}

/** What `useThreadActions` gives a thread. */
export interface ThreadActions {
	actions: Action[];
	/** Archives the conversation, asking first while its shell runs. */
	archive: { file: (then?: () => void) => void; confirm: JSX.Element };
	/** Opens the new conversation screen with `text` typed. */
	startNew: (text: string) => void;
}

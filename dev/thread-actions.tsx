import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	FileDiffIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useCallback, useContext } from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import type { ConversationState } from "../conversations";
import type { AgentPick } from "../roster";
import type { Details } from "../show";
import type { Action } from "./actions";
import { ReviewChanges } from "./changes";
import { NEW } from "./conversation-address";
import { useArchive } from "./conversation-item";
import { promptFor } from "./dispatch";
import { Dispatching } from "./dispatching";
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
	// A new conversation started on todo `id`, with the agent it is assigned
	// to on its model, else with this one's agent; without dispatching, the
	// new conversation screen with its prompt typed ahead of what waits there.
	const dispatching = useContext(Dispatching);
	const startNew = useCallback(
		(todo: number, assignee: AgentPick | null) => {
			const assignment = { kind: "todo", id: todo } as const;
			if (dispatching !== null) {
				const onRoster =
					assignee !== null &&
					dispatching.dispatch.agents.some(
						(each) => each.id === assignee.agent,
					);
				void dispatching.dispatch
					.begin(
						onRoster ? assignee : { agent: conversation.agent },
						assignment,
					)
					.then(onOpen);
				return;
			}
			const text = promptFor(assignment);
			const key = newDraft(new URLSearchParams(location.search).get("project"));
			const kept = drafts.read(key);
			drafts.write(key, kept.trim() === "" ? text : `${text}\n\n${kept}`);
			onOpen(`${NEW}/${conversation.agent}`);
		},
		[dispatching, drafts, onOpen, conversation.agent],
	);
	return { actions, archive, startNew };
}

/** What `useThreadActions` gives a thread. */
export interface ThreadActions {
	actions: Action[];
	/** Archives the conversation, asking first while its shell runs. */
	archive: { file: (then?: () => void) => void; confirm: JSX.Element };
	/** Starts todo `id` in a new conversation, with `assignee` when on the roster. */
	startNew: (id: number, assignee: AgentPick | null) => void;
}

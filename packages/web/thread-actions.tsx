import type { ConversationState } from "@stringsync/splates-server/conversations";
import { paused } from "@stringsync/splates-server/conversations/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { DEFER, RESUME } from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ClockIcon,
	FileDiffIcon,
	Loader2Icon,
	PauseIcon,
	PlayIcon,
	SquareTerminalIcon,
	WalletIcon,
} from "lucide-react";
import { type JSX, useCallback, useContext } from "react";
import { Kbd } from "#web/components/ui/kbd.tsx";
import type { Action } from "./actions";
import { ReviewChanges } from "./changes";
import { NEW } from "./conversation-address";
import {
	pauseConversation,
	promptConversation,
	sendQueuedNow,
} from "./conversation-api";
import { useArchive } from "./conversation-archive";
import { promptFor } from "./dispatch";
import { Dispatching } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { useShortcut, useShortcutLabel } from "./hooks/use-shortcut";
import type { Refuse } from "./refusal";
import { useStamps } from "./stamp";
import { ToggleTerminal } from "./terminal";

/**
 * What a conversation's thread offers beside it: reviewing its task's
 * changes, its terminal, pausing its agent at a checkpoint and resuming it,
 * deferring what the person last asked, showing its messages' timestamps,
 * and archiving it, which ⌥⌘⌫ (Ctrl+Alt+Backspace off a Mac) does too; and
 * starting a new conversation with its agent.
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
	const dispatching = useContext(Dispatching);
	const stamps = useStamps();
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
		...pauseActions(conversation, refused),
		{
			label: stamps.shown ? "Hide timestamps" : "Show timestamps",
			icon: <ClockIcon />,
			run: stamps.toggle,
		},
		{
			label: archived ? "Unarchive" : "Archive",
			icon: archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />,
			detail:
				archived || archiveKey === null ? undefined : <Kbd>{archiveKey}</Kbd>,
			run: () => archive.file(archived ? undefined : onLeft),
		},
	];
	const fileByKey = () => {
		if (!archived) {
			archive.file(onLeft);
		}
	};
	useShortcut("shortcuts.archive", fileByKey);
	// A new conversation draft for todo `id`, with its assigned agent/model
	// selected, else this conversation's agent. Nothing starts until Send.
	const startNew = useCallback(
		(todo: number, assignee: AgentPick | null) => {
			const assignment = { kind: "todo", id: todo } as const;
			if (dispatching !== null) {
				const onRoster =
					assignee !== null &&
					dispatching.dispatch.agents.some(
						(each) => each.id === assignee.agent,
					);
				const pick = onRoster ? assignee : { agent: conversation.agent };
				onOpen(dispatching.dispatch.start(pick.agent, assignment, pick.model));
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
	archive: {
		file: (then?: () => void) => void;
		confirm: JSX.Element;
	};
	/** Drafts todo `id` in a new chat, with `assignee` selected when on the roster. */
	startNew: (id: number, assignee: AgentPick | null) => void;
}

/**
 * Pause, while its own agent runs, which checkpoints it and leaves it
 * stopped, and Defer under it; while it checkpoints for it, a row saying so
 * in their place; once the person's last word paused it, Resume, under a
 * row saying it waits on the worker budget when a hard stop asked it.
 */
function pauseActions(
	conversation: ConversationState,
	refused: Refuse,
): Action[] {
	const { id, status, checkpoint, pausing, archived } = conversation;
	if (pausing && checkpoint === "asked") {
		return [
			{
				label: "Pausing…",
				icon: <Loader2Icon className="animate-spin" />,
				run: null,
			},
		];
	}
	if (archived) {
		return [];
	}
	if (status !== "running") {
		// Carried on once the budget allows; Resume carries it on now.
		const waits: Action[] =
			conversation.budgetStop === null
				? []
				: [
						{
							label: "Waits on the worker budget",
							icon: <WalletIcon />,
							detail: conversation.budgetStop,
							run: null,
						},
					];
		return paused(conversation)
			? [
					...waits,
					{
						label: "Resume",
						icon: <PlayIcon />,
						run: () =>
							void promptConversation(id, RESUME).catch((error: unknown) =>
								refused("Not resumed", error),
							),
					},
				]
			: [];
	}
	if (checkpoint !== null) {
		return [];
	}
	return [
		{
			label: "Pause",
			icon: <PauseIcon />,
			run: () =>
				void pauseConversation(id).catch((error: unknown) =>
					refused("Not paused", error),
				),
		},
		{
			label: "Defer",
			icon: <ClockIcon />,
			// Sent now, stopping the turn, so the agent saves its work on the
			// request rather than finishing it first.
			run: () =>
				void promptConversation(id, DEFER)
					.then(() => sendQueuedNow(id))
					.catch((error: unknown) => refused("Not deferred", error)),
		},
	];
}

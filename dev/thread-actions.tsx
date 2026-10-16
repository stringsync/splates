import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ClockIcon,
	FileDiffIcon,
	HandshakeIcon,
	Loader2Icon,
	PauseIcon,
	PlayIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { type JSX, useCallback, useContext } from "react";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { textOf } from "../conversation-messages";
import type { ConversationState } from "../conversations";
import { CHECKPOINT, DEFER, handoffToReference, RESUME } from "../prompts";
import type { AgentPick } from "../roster";
import type { Details } from "../show";
import type { Action } from "./actions";
import { ReviewChanges } from "./changes";
import { NEW } from "./conversation-address";
import {
	pauseConversation,
	promptConversation,
	sendQueuedNow,
} from "./conversation-api";
import { useArchive } from "./conversation-item";
import { promptFor } from "./dispatch";
import { AssigneeItems, Dispatching } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { useShortcut, useShortcutLabel } from "./hooks/use-shortcut";
import type { Refuse } from "./refusal";
import { useStamps } from "./stamp";
import { ToggleTerminal } from "./terminal";

/**
 * What a conversation's thread offers beside it: reviewing its task's
 * changes, its terminal, pausing its agent at a checkpoint and resuming it,
 * deferring what the person last asked, handing its
 * task off to another agent, showing
 * its messages' timestamps, and archiving it, which ⌥⌘⌫ (Ctrl+Alt+Backspace off
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
		// Its own task only: one an orchestrator handed it goes back through
		// that conversation, which the page leaves the person no say in here.
		...(dispatching !== null &&
		conversation.task !== null &&
		conversation.handedBy === null &&
		!archived
			? [
					{
						label: "Hand off…",
						icon: <HandshakeIcon />,
						run: null,
						menu: (
							<AssigneeItems
								assignee={null}
								anyone={false}
								label="Hand off to"
								onPick={(pick) => {
									if (pick !== null) {
										void promptConversation(id, handoffToReference(pick)).catch(
											(error: unknown) => refused("Not handed off", error),
										);
									}
								}}
							/>
						),
					},
				]
			: []),
		{
			label: stamps.shown ? "Hide timestamps" : "Show timestamps",
			icon: <ClockIcon />,
			run: stamps.toggle,
		},
		...(archive.files
			? [
					{
						label: archived ? "Unarchive" : "Archive",
						icon: archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />,
						detail:
							archived || archiveKey === null ? undefined : (
								<Kbd>{archiveKey}</Kbd>
							),
						run: () => archive.file(archived ? undefined : onLeft),
					},
				]
			: []),
	];
	// Already archived, or not the person's to archive, the key does nothing.
	const fileByKey = () => {
		if (!archived && archive.files) {
			archive.file(onLeft);
		}
	};
	useShortcut("shortcuts.archive", fileByKey);
	// A new conversation started on todo `id`, with the agent it is assigned
	// to on its model, else with this one's agent; without dispatching, the
	// new conversation screen with its prompt typed ahead of what waits there.
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
	archive: {
		file: (then?: () => void) => void;
		confirm: JSX.Element;
		files: boolean;
	};
	/** Starts todo `id` in a new conversation, with `assignee` when on the roster. */
	startNew: (id: number, assignee: AgentPick | null) => void;
}

/**
 * Pause, while its own agent runs, which checkpoints it and leaves it
 * stopped, and Defer under it; while it checkpoints for it, a row saying so
 * in their place; once the person's last word paused it, Resume.
 */
function pauseActions(
	conversation: ConversationState,
	refused: Refuse,
): Action[] {
	const { id, status, checkpoint, pausing, handedBy, archived } = conversation;
	if (pausing && checkpoint === "asked") {
		return [
			{
				label: "Pausing…",
				icon: <Loader2Icon className="animate-spin" />,
				run: null,
			},
		];
	}
	if (handedBy !== null || archived) {
		return [];
	}
	if (status !== "running") {
		return paused(conversation)
			? [
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

/** Whether the person's last word to the conversation was its checkpoint. */
function paused({ messages }: ConversationState): boolean {
	const last = messages.findLast(
		(message) => message.role === "user" && message.queued !== true,
	);
	return last !== undefined && textOf(last).trim() === CHECKPOINT;
}

import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import {
	ChevronDownIcon,
	ChevronLeftIcon,
	GitBranchIcon,
	PanelRightCloseIcon,
	PanelRightIcon,
	SquarePenIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useState } from "react";
import { useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import type { Action } from "./actions";
import { Rename } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import type { Refuse } from "./refusal";
import { TakeUp, TakeUpItems } from "./take-up";
import { BarButton, TITLE, TopBar } from "./top-bar";

/**
 * A conversation's bar: its name, which a double-click renames, beside a
 * sidebar the task it runs in or one it can take up, then its widgets and a
 * new conversation. A phone leads it with the way back; there where it runs
 * is the first of its widgets.
 */
export function ThreadHeader({
	conversation,
	task,
	free,
	trunk,
	refused,
	widgets,
	onTake,
	onDetails,
	onNew,
	onBack,
}: {
	conversation: ConversationState;
	/** The task it runs in; null in the main tree, or once the task is gone. */
	task: Details | null;
	/** The tasks it can take up from the main tree. */
	free: Details[];
	/** The main tree's branch. */
	trunk: string;
	refused: Refuse;
	widgets: { open: boolean; toggle: () => void };
	/** Takes up a task, sending what says so. */
	onTake: (text: string) => void;
	/** Shows its task's details. */
	onDetails: () => void;
	/** On to a new conversation, so several start one after another. */
	onNew: () => void;
	/** Back to the inbox, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): ReactNode {
	const [renaming, setRenaming] = useState(false);
	const nameOf = useNameOf();
	const key = useShortcutLabel("shortcuts.widgets");
	const phone = onBack !== null;
	return (
		<TopBar
			leading={
				phone && (
					<BarButton label="Back to conversations" onClick={onBack}>
						<ChevronLeftIcon />
					</BarButton>
				)
			}
			title={
				renaming ? (
					<Rename
						conversation={conversation}
						refuse={refused}
						onDone={() => setRenaming(false)}
					/>
				) : (
					// A shortcut: the menu in the sidebar renames too. A long name,
					// such as a question it was named after, ends in an ellipsis.
					<h2
						onDoubleClick={() => setRenaming(!phone)}
						title={
							phone
								? nameOf(conversation)
								: `${nameOf(conversation)}\nDouble-click to rename`
						}
						className={cn(
							TITLE,
							"truncate",
							unnamed(conversation) && "text-muted-foreground italic",
						)}
					>
						{nameOf(conversation)}
					</h2>
				)
			}
			detail={
				!phone && (
					<Where
						conversation={conversation}
						task={task}
						free={free}
						trunk={trunk}
						onTake={onTake}
						onDetails={onDetails}
					/>
				)
			}
			actions={[
				{
					label: "Widgets",
					icon: widgets.open ? <PanelRightCloseIcon /> : <PanelRightIcon />,
					run: widgets.toggle,
					expanded: widgets.open,
					busy: conversation.background.some(
						(each) => each.state === "running",
					),
					shortcut: key,
				},
				{
					label: "New conversation",
					icon: <SquarePenIcon />,
					run: onNew,
					// A phone starts one from the inbox, mostly.
					kebab: phone,
				},
			]}
		/>
	);
}

/**
 * The line under a conversation's name: the task it runs in, or in the main
 * tree, one it can take up.
 */
function Where({
	conversation,
	task,
	free,
	trunk,
	onTake,
	onDetails,
}: {
	conversation: ConversationState;
	task: Details | null;
	free: Details[];
	trunk: string;
	onTake: (text: string) => void;
	onDetails: () => void;
}): JSX.Element {
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
	return conversation.task === null && !conversation.archived ? (
		<TakeUp trunk={trunk} tasks={free} onTake={onTake} />
	) : (
		<TaskLine branch={branch} task={task} onDetails={onDetails} />
	);
}

/**
 * `Where` as the first row of a phone's widgets, whose header keeps to the
 * conversation's name: its task's branch, opening the task's details, or in
 * the main tree, a menu of what it can take up.
 */
export function useWhereAction({
	conversation,
	task,
	free,
	trunk,
	onTake,
	onDetails,
}: {
	conversation: ConversationState;
	task: Details | null;
	free: Details[];
	trunk: string;
	onTake: (text: string) => void;
	onDetails: () => void;
}): Action | null {
	if (conversation.task === null && !conversation.archived) {
		return {
			label: trunk,
			icon: <GitBranchIcon />,
			detail: <ChevronDownIcon className="size-4" />,
			run: null,
			menu: <TakeUpItems tasks={free} onTake={onTake} />,
			menuClassName: "max-h-80 w-80 overflow-y-auto",
		};
	}
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
	if (branch === null) {
		return null;
	}
	return {
		label: branch,
		icon: <GitBranchIcon />,
		run: task === null ? null : onDetails,
	};
}

/**
 * The line under a header's title: the branch, which opens the task's
 * details on a click.
 */
export function TaskLine({
	branch,
	task,
	onDetails,
}: {
	/** Null once its task is gone. */
	branch: string | null;
	task: Details | null;
	onDetails: () => void;
}): JSX.Element | null {
	if (branch === null) {
		return null;
	}
	const line = (
		<>
			<GitBranchIcon
				role="img"
				aria-label="branch"
				className="size-3 shrink-0"
			/>
			<span className="truncate">{branch}</span>
		</>
	);
	if (task === null) {
		return (
			<p className="flex min-w-0 items-center gap-1 text-muted-foreground text-xs">
				{line}
			</p>
		);
	}
	return (
		<button
			type="button"
			aria-label={`About ${task.task}`}
			onClick={onDetails}
			className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
		>
			{line}
		</button>
	);
}

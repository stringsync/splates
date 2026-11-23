import type { ConversationState } from "@splates/server/conversations";
import type { Details } from "@splates/server/tasks";
import {
	ChevronDownIcon,
	ChevronLeftIcon,
	GitBranchIcon,
	PanelRightCloseIcon,
	PanelRightIcon,
	SquarePenIcon,
} from "lucide-react";
import { type ReactNode, useContext, useState } from "react";
import { useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import type { Action } from "./actions";
import { backgrounded } from "./backgrounded";
import { Rename } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import type { Refuse } from "./refusal";
import { TakeUpItems } from "./take-up";
import { type BarAction, BarButton, TopBar, TopBarFrame } from "./top-bar";

/**
 * Renders a conversation's header bar with its renameable title, widgets
 * toggle, and new-conversation action. Pass `onBack` on a phone to return to
 * the inbox, and `extraActions` for thread-specific controls.
 */
export function ThreadHeader({
	conversation,
	refused,
	widgets,
	onNew,
	onBack,
	extraActions = [],
}: {
	conversation: ConversationState;
	refused: Refuse;
	widgets: { open: boolean; toggle: () => void };
	/** On to a new conversation, so several start one after another. */
	onNew: () => void;
	/** Back to the inbox, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
	/** Extra actions shown before Widgets, such as Unqueue on a queued task's thread. */
	extraActions?: readonly BarAction[];
}): ReactNode {
	const project = useContext(TopBarFrame)?.project;
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
				<div className="flex min-w-0 flex-col">
					{renaming ? (
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
								"min-w-0 truncate font-medium text-sm",
								unnamed(conversation) && "text-muted-foreground italic",
							)}
						>
							{nameOf(conversation)}
						</h2>
					)}
					{project !== undefined && (
						<span
							title={project}
							className="truncate text-muted-foreground text-[11px] leading-4"
						>
							{project}
						</span>
					)}
				</div>
			}
			actions={[
				...extraActions,
				{
					label: "Widgets",
					icon: widgets.open ? <PanelRightCloseIcon /> : <PanelRightIcon />,
					run: widgets.toggle,
					expanded: widgets.open,
					busy: backgrounded(conversation),
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
 * Where a conversation runs, as the first row of its widgets: its task's
 * branch, opening the task's details, or in the main tree, a menu of what it
 * can take up.
 */
export function useWhereAction({
	conversation,
	task,
	free,
	trunk,
	onTake,
	onDetails,
	// vet-ignore objects-over-callbacks: a hook's arguments that wire the header's actions to the page
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

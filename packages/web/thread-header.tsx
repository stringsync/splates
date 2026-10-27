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
import { type ReactNode, useState } from "react";
import { useShortcutLabel } from "#web/hooks/use-shortcut.ts";
import { cn } from "#web/lib/utils.ts";
import type { Action } from "./actions";
import { Rename } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import type { Refuse } from "./refusal";
import { TakeUpItems } from "./take-up";
import { BarButton, TITLE, TopBar } from "./top-bar";

/**
 * A conversation's bar: its name, which a double-click renames, then its
 * widgets and a new conversation. A phone leads it with the way back and names
 * the project under the name. Where it runs is the first of its widgets.
 */
export function ThreadHeader({
	conversation,
	refused,
	widgets,
	onNew,
	onBack,
}: {
	conversation: ConversationState;
	refused: Refuse;
	widgets: { open: boolean; toggle: () => void };
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
			project
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

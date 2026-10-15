import { type JSX, useState } from "react";
import { cn } from "#dev/lib/utils.ts";
import type { ConversationState } from "../conversations";
import type { Details } from "../show";
import { WidgetsButton } from "./actions";
import { Rename } from "./conversation-item";
import { unnamed, useNameOf } from "./conversation-names";
import { useHandedOutBy } from "./handed-out";
import type { Refuse } from "./refusal";
import { TakeUp } from "./take-up";
import { TaskLine } from "./task-view";

/**
 * A conversation's header: its name, which a double-click renames, the task
 * it runs in or one it can take up, and the button that shows its widgets.
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
}): JSX.Element {
	const [renaming, setRenaming] = useState(false);
	// One that answers to another is that one's to rename and set to work.
	const handedOut = useHandedOutBy(conversation) !== null;
	const nameOf = useNameOf();
	return (
		<header className="flex min-h-9 items-center gap-2">
			<div className="flex min-w-0 flex-1 flex-col">
				{renaming ? (
					<Rename
						conversation={conversation}
						refuse={refused}
						onDone={() => setRenaming(false)}
					/>
				) : (
					// A shortcut: the menu in the sidebar renames too. Capped, so a
					// long name, such as a question it was named after, ends in an
					// ellipsis rather than running across the pane.
					<div className="flex min-w-0 items-center gap-2">
						<h2
							onDoubleClick={() => setRenaming(!handedOut)}
							title={
								handedOut
									? nameOf(conversation)
									: `${nameOf(conversation)}\nDouble-click to rename`
							}
							className={cn(
								"max-w-md truncate font-medium text-sm",
								unnamed(conversation) && "text-muted-foreground italic",
							)}
						>
							{nameOf(conversation)}
						</h2>
					</div>
				)}
				<Where
					conversation={conversation}
					task={task}
					free={free}
					trunk={trunk}
					onTake={onTake}
					onDetails={onDetails}
				/>
			</div>
			<WidgetsButton
				open={widgets.open}
				onToggle={widgets.toggle}
				busy={conversation.background.some((each) => each.state === "running")}
			/>
		</header>
	);
}

/**
 * The line under a conversation's name: the task it runs in, or in the main
 * tree, one it can take up.
 */
export function Where({
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
	const handedOut = useHandedOutBy(conversation) !== null;
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
	return conversation.task === null && !conversation.archived && !handedOut ? (
		<TakeUp trunk={trunk} tasks={free} onTake={onTake} />
	) : (
		<TaskLine branch={branch} task={task} onDetails={onDetails} />
	);
}

import type { LucideIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { cn } from "#dev/lib/utils.ts";
import { Board } from "./board";
import { TaskIcon } from "./task-icon";

/**
 * A chip naming a todo, lane, task or branch, as the composer draws its
 * directives: an icon, what it is, then its name. Given `open`, a tap opens
 * what it names; given `inline`, it sits in a line of text.
 */
export function ReferenceChip({
	Icon,
	kind,
	name,
	title,
	open,
	inline = false,
}: {
	Icon: LucideIcon;
	kind: string;
	name: string;
	title: string;
	open?: (() => void) | undefined;
	inline?: boolean;
}): JSX.Element {
	const inside = (
		<>
			<Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
			{kind !== "" && <span className="shrink-0 font-medium">{kind}</span>}
			{name !== "" && (
				<span className="min-w-0 truncate text-muted-foreground">{name}</span>
			)}
		</>
	);
	const look = cn(
		"max-w-80 min-w-0 shrink-0 items-center gap-1 rounded-md border px-1.5 text-foreground/90 text-xs",
		inline ? "inline-flex h-6 align-middle" : "flex h-7",
	);
	if (open !== undefined) {
		return (
			<button
				type="button"
				title={title}
				onClick={(event) => {
					// Opens what it names, rather than what it sits in.
					event.stopPropagation();
					open();
				}}
				className={`${look} cursor-pointer hover:bg-muted`}
			>
				{inside}
			</button>
		);
	}
	return (
		<span title={title} className={look}>
			{inside}
		</span>
	);
}

/**
 * A task, named wherever the page mentions one; a tap opens it while it is
 * live, as the page has nothing to show of one merged or removed.
 */
export function TaskChip({
	task,
	inline = false,
}: {
	task: string;
	inline?: boolean;
}): JSX.Element {
	const board = useContext(Board);
	return (
		<ReferenceChip
			Icon={TaskIcon}
			kind="Task"
			name={task}
			title={task}
			open={
				board.linked && board.tasks.includes(task)
					? () => board.openTask(task)
					: undefined
			}
			inline={inline}
		/>
	);
}

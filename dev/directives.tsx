import {
	ColumnsIcon,
	GitBranchIcon,
	ListTodoIcon,
	type LucideIcon,
	SparklesIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { cn } from "#dev/lib/utils.ts";
import { Board, type BoardContext } from "./board";

/**
 * What a directive is about, as its chip names it, and how to open it when the
 * page can: a todo still on the board, or a task.
 */
function about(
	directive: string,
	board: BoardContext,
): {
	icon: LucideIcon;
	kind: string;
	name: string;
	open?: (() => void) | undefined;
} {
	const [, kind = "", argument = ""] =
		/^\[ARBOR ([A-Z]+)(?: ([^\]]+))?\]$/.exec(directive) ?? [];
	switch (kind) {
		case "TODO": {
			const id = Number(argument.replace("#", ""));
			const todo = board.todos.find((each) => each.id === id);
			return {
				icon: ListTodoIcon,
				kind: `Todo ${argument}`,
				name: todo?.subject ?? "",
				open: todo === undefined ? undefined : () => board.open(id),
			};
		}
		case "LANE": {
			const id = Number(argument);
			return {
				icon: ColumnsIcon,
				kind: `Lane ${argument}`,
				name: board.lanes.find((each) => each.id === id)?.name ?? "",
			};
		}
		case "TASK":
			return {
				icon: GitBranchIcon,
				kind: "Task",
				name: argument,
				open: () => board.openTask(argument),
			};
		default:
			return {
				icon: SparklesIcon,
				kind: kind.charAt(0) + kind.slice(1).toLowerCase(),
				name: argument,
			};
	}
}

/**
 * A directive as the composer shows it: what it is about, named from the
 * board, the directive itself in its title. Given `opens`, as in a sent
 * message, a tap opens the todo or task it names; given `inline`, it sits in
 * a line of text.
 */
export function DirectiveChip({
	directive,
	opens = false,
	inline = false,
}: {
	directive: string;
	opens?: boolean;
	inline?: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const { icon: Icon, kind, name, open } = about(directive, board);
	const inside = (
		<>
			<Icon aria-hidden className="size-3.5 shrink-0" />
			<span className="shrink-0 font-medium">{kind}</span>
			{name !== "" && (
				<span className="min-w-0 truncate text-foreground/80">{name}</span>
			)}
		</>
	);
	const look = cn(
		"max-w-80 min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 ps-2 pe-1 text-primary text-xs",
		inline ? "inline-flex h-6 align-middle" : "flex h-7",
	);
	if (opens && board.linked && open !== undefined) {
		return (
			<button
				type="button"
				title={directive}
				onClick={(event) => {
					// Opens what it names, rather than the message it sits in.
					event.stopPropagation();
					open();
				}}
				className={`${look} cursor-pointer hover:bg-primary/15`}
			>
				{inside}
			</button>
		);
	}
	return (
		<span title={directive} className={look}>
			{inside}
		</span>
	);
}

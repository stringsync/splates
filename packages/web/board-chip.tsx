import type {
	BoardRecord,
	LaneRecord,
	TaskRecord,
} from "@splates/server/board/browser";
import type { JSX, ReactNode } from "react";
import { useContext, useMemo } from "react";
import { cn } from "#web/lib/utils.ts";
import { Board, type BoardContext } from "./board";
import { coverOf } from "./board-tile";

/** The chip classes of each cover accent a board wears, light and dark. */
const ACCENTS: Readonly<Record<string, string>> = {
	blue: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
	green: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
	amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
	rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-300",
	violet:
		"bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-300",
	teal: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-300",
	indigo:
		"bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
};

const SLATE =
	"bg-zinc-200 text-zinc-700 dark:bg-zinc-500/25 dark:text-zinc-300";

/**
 * The board a task is on: the board of the lane of the todo the task took,
 * or, with `held`, of the todo a queued row waits for. Null for a task on
 * none, such as one started outside the queue.
 */
export function boardOfTask(
	board: BoardContext,
	task: string | null | undefined,
	held?: number | null,
): { id: number; name: string } | null {
	const todo = board.todos.find((each) =>
		held == null ? task != null && each.takenBy === task : each.id === held,
	);
	if (todo?.lane == null) {
		return null;
	}
	const lane = board.lanes.find((each) => each.id === todo.lane);
	const id = lane?.board ?? board.boards?.[0]?.id;
	return board.boards?.find((each) => each.id === id) ?? null;
}

/** A task's board as a quiet chip in the board's cover color; nothing for a task on none. */
export function BoardChip({
	task,
	held,
	className,
}: {
	task: string | null | undefined;
	held?: number | null;
	className?: string;
}): JSX.Element | null {
	const found = boardOfTask(useContext(Board), task, held);
	if (found === null) {
		return null;
	}
	return (
		<span
			title={`Board ${found.name}`}
			className={cn(
				"max-w-32 shrink-0 truncate rounded px-1 text-[11px] leading-4",
				ACCENTS[coverOf(found.id).accent ?? ""] ?? SLATE,
				className,
			)}
		>
			{found.name}
		</span>
	);
}

/**
 * Tells the rows beneath it which board each task is on, from the project's
 * `todos`, `lanes` and `boards`, which a page outside the board does not
 * otherwise carry.
 */
export function BoardScope({
	todos,
	lanes,
	boards,
	children,
}: {
	todos: TaskRecord[];
	lanes: LaneRecord[];
	boards: BoardRecord[] | undefined;
	children: ReactNode;
}): JSX.Element {
	const outer = useContext(Board);
	const value = useMemo(
		() => ({ ...outer, todos, lanes, boards }),
		[outer, todos, lanes, boards],
	);
	return <Board value={value}>{children}</Board>;
}

import type { TaskRecord } from "@stringsync/splates-server/board";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	HandIcon,
	ListXIcon,
	MoreHorizontalIcon,
	RotateCcwIcon,
	Trash2Icon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { manualTodo, moveInQueue, queueTodo } from "./api";
import { touchItems } from "./board";
import { manualOf, queued, queueMoved } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import type { Refuse } from "./refusal";

/**
 * What can be done to a queued task from the Tasks page's queue: move it
 * up or down the line, have only you queue it (a lane then passes over it)
 * or let a lane, take it out of the queue, or remove it.
 */
export function QueueRowMenu({
	todo,
	place,
	last,
	refuse,
	onRemove,
}: {
	todo: TaskRecord;
	/** Its place in the queue, from 0 for the next to start. */
	place: number;
	/** The place of the last one queued. */
	last: number;
	refuse: Refuse;
	onRemove: (todo: TaskRecord) => void;
}): JSX.Element {
	const expect = useExpectSnapshot();
	const move = (to: number) =>
		void expect(queueMoved(todo.id, to), moveInQueue(todo.id, to)).catch(
			(error: unknown) => refuse("Not moved", error),
		);
	const manual = todo.manual === true;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`#${todo.id} actions`}
						className="shrink-0 pointer-coarse:size-10"
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={cn("w-56", touchItems)}>
				<DropdownMenuItem disabled={place === 0} onClick={() => move(place)}>
					<ArrowUpIcon />
					Move up
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={place === last}
					onClick={() => move(place + 2)}
				>
					<ArrowDownIcon />
					Move down
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() =>
						void expect(
							manualOf(todo.id, !manual),
							manualTodo(todo.id, !manual),
						).catch((error: unknown) =>
							refuse(manual ? "Not made auto" : "Not made manual", error),
						)
					}
				>
					{manual ? <RotateCcwIcon /> : <HandIcon />}
					{manual ? "Let lanes queue it" : "Only I queue it"}
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						void expect(
							queued(todo.id, false),
							queueTodo(todo.id, false),
						).catch((error: unknown) => refuse("Not taken out", error))
					}
				>
					<ListXIcon />
					Take out of queue
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => onRemove(todo)}>
					<Trash2Icon />
					Remove
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

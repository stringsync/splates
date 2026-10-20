import {
	taskNumberReference,
	taskReference,
} from "@stringsync/splates-server/plans/browser";
import type { Details } from "@stringsync/splates-server/tasks";
import { ListTodoIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "#web/components/ui/dropdown-menu.tsx";
import { Board } from "./board";
import { TaskIcon } from "./task-icon";

/**
 * The tasks and open todos a main-tree conversation can take up, as a
 * menu's items, for the row atop its widgets.
 */
export function TakeUpItems({
	tasks,
	onTake,
}: {
	tasks: Details[];
	onTake: (text: string) => void;
}): JSX.Element {
	const board = useContext(Board);
	const todos = board.todos
		.filter((each) => each.takenBy === null)
		.sort((one, other) => one.position - other.position);
	return (
		<>
			{tasks.length === 0 && todos.length === 0 && (
				<p className="px-1.5 py-1 text-muted-foreground text-xs">
					No task to take up.
				</p>
			)}
			{tasks.length > 0 && (
				<DropdownMenuGroup>
					<DropdownMenuLabel>Claim a started task</DropdownMenuLabel>
					{tasks.map((each) => (
						<DropdownMenuItem
							key={each.task}
							onClick={() => onTake(taskReference(each.task))}
						>
							<TaskIcon aria-hidden />
							<span className="truncate">{each.task}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			)}
			{tasks.length > 0 && todos.length > 0 && <DropdownMenuSeparator />}
			{todos.length > 0 && (
				<DropdownMenuGroup>
					<DropdownMenuLabel>Start a task</DropdownMenuLabel>
					{todos.map((each) => (
						<DropdownMenuItem
							key={each.id}
							onClick={() => onTake(taskNumberReference(each.id))}
						>
							<ListTodoIcon aria-hidden />
							<span className="min-w-0 flex-1 truncate">{each.subject}</span>
							<span className="shrink-0 text-muted-foreground tabular-nums">
								#{each.id}
							</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			)}
		</>
	);
}

import { ChevronDownIcon, GitBranchIcon, ListTodoIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { taskReference, todoReference } from "../prompts";
import type { Details } from "../show";
import { Board } from "./board";

/**
 * The line under a main-tree conversation's title: the trunk's branch, which
 * opens a menu of the tasks and open todos its agent can take up. Picking one
 * asks the agent to claim it, and the conversation follows it there.
 */
export function TakeUp({
	trunk,
	tasks,
	onTake,
}: {
	trunk: string;
	tasks: Details[];
	/** Sends the prompt that takes it up. */
	onTake: (text: string) => void;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label="Take up a task or todo"
						title="Take up a task or todo"
						className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
					>
						<GitBranchIcon
							role="img"
							aria-label="branch"
							className="size-3 shrink-0"
						/>
						<span className="truncate">{trunk}</span>
						<ChevronDownIcon aria-hidden className="size-3 shrink-0" />
					</button>
				}
			/>
			<DropdownMenuContent className="max-h-80 w-80 overflow-y-auto">
				<TakeUpItems tasks={tasks} onTake={onTake} />
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/**
 * The tasks and open todos a main-tree conversation can take up, as a
 * menu's items: `TakeUp`'s, and a phone's widget row's.
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
					No task or open todo to take up.
				</p>
			)}
			{tasks.length > 0 && (
				<DropdownMenuGroup>
					<DropdownMenuLabel>Claim a task</DropdownMenuLabel>
					{tasks.map((each) => (
						<DropdownMenuItem
							key={each.task}
							onClick={() => onTake(taskReference(each.task))}
						>
							<GitBranchIcon aria-hidden />
							<span className="truncate">{each.task}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
			)}
			{tasks.length > 0 && todos.length > 0 && <DropdownMenuSeparator />}
			{todos.length > 0 && (
				<DropdownMenuGroup>
					<DropdownMenuLabel>Start a todo</DropdownMenuLabel>
					{todos.map((each) => (
						<DropdownMenuItem
							key={each.id}
							onClick={() => onTake(todoReference(each.id))}
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

import { age } from "@stringsync/splates-server/age";
import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DropdownMenuItem } from "#web/components/ui/dropdown-menu.tsx";
import {
	manualTodo,
	moveInQueue,
	queueTodo,
	removeTodo,
	restoreTodo,
} from "./api";
import {
	manualOf,
	queued,
	queueMoved,
	todoRemoved,
	todoRestored,
} from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { QueueEmpty, QueueRow, QueueSection, SortableRows } from "./queue-rows";
import { Refusal, useRefusal } from "./refusal";

/**
 * What the queue has yet to start, as `splates queue list` has it: the
 * queued tasks no agent has taken, in the order they start, dragged into
 * another, each with what it waits on and how long it has. Each opens its
 * card on the board; its menu has only the person queue it, takes it out
 * of the queue, or removes it.
 */
export function UpNext({
	todos,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	onOpen: (id: number) => void;
}): JSX.Element {
	const queue = queueOrder(todos);
	const expect = useExpectSnapshot();
	const { refusal, refuse } = useRefusal();
	// The task last removed from here, kept for Undo to put back.
	const [removed, setRemoved] = useState<TaskRecord | null>(null);
	const attempt = (title: string, write: Promise<unknown>) =>
		void write.catch((error: unknown) => refuse(title, error));
	const remove = (todo: TaskRecord) => {
		setRemoved(todo);
		void expect(todoRemoved(todo.id), removeTodo(todo.id)).catch(
			(error: unknown) => {
				setRemoved(null);
				refuse("Not removed", error);
			},
		);
	};
	const undo = (todo: TaskRecord) => {
		setRemoved(null);
		void expect(todoRestored(todo), restoreTodo(todo.id)).catch(
			(error: unknown) => {
				setRemoved(todo);
				refuse("Not put back", error);
			},
		);
	};
	// A place in the queue counts from 1.
	const move = (id: string, to: number) =>
		attempt(
			"Not moved",
			expect(queueMoved(Number(id), to + 1), moveInQueue(Number(id), to + 1)),
		);
	return (
		<QueueSection title="Up next" count={queue.length}>
			{removed !== null && (
				<p className="flex h-10 items-center gap-2 px-4 text-muted-foreground text-sm">
					<span className="min-w-0 flex-1 truncate">
						Removed #{removed.id} {removed.subject}
					</span>
					<Button size="xs" variant="ghost" onClick={() => undo(removed)}>
						Undo
					</Button>
				</p>
			)}
			<Refusal refusal={refusal} />
			{queue.length === 0 ? (
				<QueueEmpty>Nothing queued</QueueEmpty>
			) : (
				<SortableRows
					items={queue}
					idOf={(todo) => String(todo.id)}
					label="queued tasks"
					onMove={move}
					row={(todo, { grip, dragging }) => {
						const manual = todo.manual === true;
						return (
							<QueueRow
								grip={grip}
								dragging={dragging}
								name={todo.subject}
								by={
									waitsOn(todo, todos) ??
									(manual ? "only you queue" : undefined)
								}
								age={
									todo.queuedAt === undefined ? undefined : (
										<span title="How long it has waited in the queue">
											<span className="sr-only">Waiting: </span>
											{age(todo.queuedAt)}
										</span>
									)
								}
								id={`#${todo.id}`}
								main={{ label: "Open", onClick: () => onOpen(todo.id) }}
								menu={
									<>
										<DropdownMenuItem
											onClick={() =>
												attempt(
													manual ? "Not made auto" : "Not made manual",
													expect(
														manualOf(todo.id, !manual),
														manualTodo(todo.id, !manual),
													),
												)
											}
										>
											{manual ? "Let lanes queue it" : "Only I queue it"}
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() =>
												attempt(
													"Not taken out",
													expect(
														queued(todo.id, false),
														queueTodo(todo.id, false),
													),
												)
											}
										>
											Take out of queue
										</DropdownMenuItem>
										<DropdownMenuItem onClick={() => remove(todo)}>
											Remove
										</DropdownMenuItem>
									</>
								}
							/>
						);
					}}
				/>
			)}
		</QueueSection>
	);
}

/** What queued task `todo` waits on to land, as `waits on #3, #4`, or null for nothing. */
function waitsOn(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
): string | null {
	const open = todos.filter((other) => todo.blockedBy.includes(other.id));
	return open.length === 0
		? null
		: `waits on ${open.map((other) => `#${other.id}`).join(", ")}`;
}

import { age } from "@stringsync/splates-server/age";
import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DropdownMenuItem } from "#web/components/ui/dropdown-menu.tsx";
import { moveInQueue, queueTodo, removeTodo, restoreTodo } from "./api";
import {
	blockedFix,
	blockedQueue,
	chainLines,
	fixLabel,
	upNext,
	useApplyFix,
	useUndoQueued,
} from "./blocked-fix";
import {
	queued,
	queueMoved,
	todoRemoved,
	todoRestored,
} from "./board-expectations";
import { useExpectSnapshot, usePendingSnapshot } from "./expecting";
import { QueueEmpty, QueueRow, QueueSection, SortableRows } from "./queue-rows";
import { Refusal, useRefusal } from "./refusal";
import { waitLines, waitsOn, waitsShort } from "./waits-on";

/**
 * What the queue has yet to start, as `splates queue list` has it: the
 * queued tasks no agent has taken, in the order they start, dragged into
 * another, each with what it waits on and how long it has; the blocked ones
 * are under Blocked instead. Each opens its card on the board; its menu takes
 * it out of the queue, or removes it.
 */
export function UpNext({
	todos,
	lanes,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	lanes: LaneRecord[];
	onOpen: (id: number) => void;
}): JSX.Element {
	const queue = upNext(todos);
	const expect = useExpectSnapshot();
	const { refusal, refuse } = useRefusal();
	// The task last removed from here, kept for Undo to put back.
	const [removed, setRemoved] = useState<TaskRecord | null>(null);
	const undoing = usePendingSnapshot(
		removed === null ? "" : `todo:${removed.id}`,
	);
	const attempt = (title: string, write: Promise<unknown>) =>
		void write.catch((error: unknown) => refuse(title, error));

	const remove = (todo: TaskRecord) => {
		// Undo offers once the server has dropped it, not before.
		void expect(todoRemoved(todo.id), removeTodo(todo.id)).then(
			() => setRemoved(todo),
			(error: unknown) => refuse("Not removed", error),
		);
	};
	const undo = (todo: TaskRecord) => {
		void expect(todoRestored(todo), restoreTodo(todo.id)).then(
			() => setRemoved(null),
			(error: unknown) => refuse("Not put back", error),
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
					<Button
						size="xs"
						variant="ghost"
						disabled={undoing}
						onClick={() => undo(removed)}
					>
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
						const waits = waitsOn(todo, todos, lanes);
						return (
							<QueueRow
								pendingKey={`todo:${todo.id}`}
								grip={grip}
								dragging={dragging}
								name={todo.subject}
								by={
									waits.length > 0 ? (
										<span title={waitLines(waits)}>{waitsShort(waits)}</span>
									) : undefined
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

/**
 * The queued tasks that cannot start until the person queues what they wait
 * on or drops a link, each with what holds it and its card's fix: Queue N
 * blockers, Drop link, or the task whose fix clears it too, which opens.
 * Once blockers are queued, which ones, with Undo.
 */
export function BlockedTasks({
	todos,
	lanes,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	lanes: LaneRecord[];
	onOpen: (id: number) => void;
}): JSX.Element | null {
	const blocked = blockedQueue(todos);
	const apply = useApplyFix();
	const undo = useUndoQueued();
	const { refusal, refuse } = useRefusal();
	// The tasks the last fix queued, for Undo, with the one it was for.
	const [done, setDone] = useState<{ for: number; ids: number[] } | null>(null);
	if (blocked.length === 0 && done === null) {
		return null;
	}
	return (
		<QueueSection title="Blocked" count={blocked.length}>
			{done !== null && (
				<p className="flex h-10 items-center gap-2 px-4 text-muted-foreground text-sm">
					<span className="min-w-0 flex-1 truncate">
						Queued {done.ids.map((id) => `#${id}`).join(", ")} for #{done.for}
					</span>
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							void undo(done.ids).then(
								() => setDone(null),
								(error: unknown) => refuse("Not undone", error),
							);
						}}
					>
						Undo
					</Button>
				</p>
			)}
			<Refusal refusal={refusal} />
			{blocked.map((todo) => {
				const fix = blockedFix(todo, todos);
				const holds =
					fix === null
						? undefined
						: fix.kind === "queue"
							? `needs ${fix.chain.map((task) => `#${task.id}`).join(", ")} queued`
							: fix.kind === "drop"
								? `waits on ${fix.lost.map((id) => `#${id}`).join(", ")}, removed`
								: `blocked with #${fix.id}`;
				return (
					<QueueRow
						key={todo.id}
						pendingKey={`todo:${todo.id}`}
						name={todo.subject}
						by={
							holds === undefined ? undefined : (
								<span
									className="text-warning"
									title={
										fix?.kind === "queue"
											? chainLines(fix.chain, lanes)
											: undefined
									}
								>
									{holds}
								</span>
							)
						}
						id={`#${todo.id}`}
						quiet={
							fix === null
								? undefined
								: fix.kind === "with"
									? { label: `Open #${fix.id}`, onClick: () => onOpen(fix.id) }
									: {
											label: fixLabel(fix),
											onClick: () =>
												void apply(todo, fix).then(
													(ids) =>
														setDone(
															ids.length > 0 ? { for: todo.id, ids } : null,
														),
													(error: unknown) =>
														refuse(
															fix.kind === "queue"
																? "Blockers not queued"
																: "Not unlinked",
															error,
														),
												),
										}
						}
						main={{ label: "Open", onClick: () => onOpen(todo.id) }}
					/>
				);
			})}
		</QueueSection>
	);
}

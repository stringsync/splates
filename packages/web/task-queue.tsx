import { age } from "@splates/server/age";
import type { TaskRecord } from "@splates/server/board";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	blockedFix,
	blockedQueue,
	chainLines,
	upNext,
	useUndoQueued,
} from "./blocked-fix";
import { Board } from "./board";
import { Card } from "./card";
import { QueueColumn } from "./queue-column";
import { QueueEmpty } from "./queue-rows";

/** Lists the queued tasks that can start, numbered in start order. Pass `shown` to filter what is listed. */
export function QueuedColumn({
	shown = () => true,
	staleness,
}: {
	/** Which of the queue to list; every card keeps its place in the whole queue. */
	shown?: (todo: TaskRecord) => boolean;
	staleness: number;
}): JSX.Element {
	const { todos } = useContext(Board);
	const places = upNext(todos).flatMap((todo, at) =>
		shown(todo) ? [{ todo, place: at + 1 }] : [],
	);
	return (
		<QueueColumn
			title="Queued"
			why="Permanent column: queued tasks free to start, next first. A card arrives when you queue its task, and leaves when an agent starts it or you press Unqueue."
			count={places.length}
		>
			{places.length === 0 ? (
				<QueueEmpty>Nothing queued</QueueEmpty>
			) : (
				<ol aria-label="queued tasks" className="flex flex-col gap-1.5">
					{places.map(({ todo, place }) => (
						<li key={todo.id}>
							<Card
								todo={todo}
								staleness={staleness}
								step={place}
								listed
								detail={waited(todo)}
							/>
						</li>
					))}
				</ol>
			)}
		</QueueColumn>
	);
}

/** Lists the queued tasks stuck until the person acts, each saying what holds it, with its fix on the card. */
export function BlockedColumn({
	shown = () => true,
	staleness,
}: {
	/** Which of the blocked to list; blockers are still read from every todo. */
	shown?: (todo: TaskRecord) => boolean;
	staleness: number;
}): JSX.Element {
	const { todos, refuseTodo } = useContext(Board);
	const blocked = blockedQueue(todos).filter(shown);
	const undo = useUndoQueued();
	// What the last fix queued, for Undo, since its card has left this column.
	const [done, setDone] = useState<{ for: number; ids: number[] } | null>(null);
	return (
		<QueueColumn
			title="Blocked"
			why="Permanent column: queued tasks that cannot start yet. A card leaves on its own once what holds it clears, or when you press Unqueue."
			count={blocked.length}
		>
			{done !== null && (
				<p className="flex items-center gap-2 px-1.5 text-muted-foreground text-xs">
					<span className="min-w-0 flex-1 truncate">
						Queued {done.ids.map((id) => `#${id}`).join(", ")} for #{done.for}
					</span>
					<Button
						size="xs"
						variant="ghost"
						onClick={() => {
							void undo(done.ids).then(
								() => setDone(null),
								(error: unknown) => refuseTodo(done.for, "Not undone", error),
							);
						}}
					>
						Undo
					</Button>
				</p>
			)}
			{blocked.length === 0 ? (
				<QueueEmpty>Nothing blocked</QueueEmpty>
			) : (
				<ul aria-label="blocked tasks" className="flex flex-col gap-1.5">
					{blocked.map((todo) => (
						<li key={todo.id}>
							<Card
								todo={todo}
								staleness={staleness}
								listed
								detail={<Holds todo={todo} />}
								onFixed={(ids) => setDone({ for: todo.id, ids })}
							/>
						</li>
					))}
				</ul>
			)}
		</QueueColumn>
	);
}

/** How long a card has waited in the queue. */
function waited(todo: TaskRecord): ReactNode {
	return todo.queuedAt === undefined ? undefined : (
		<span title="How long it has waited in the queue">
			<span className="sr-only">Waiting: </span>
			{age(todo.queuedAt)}
		</span>
	);
}

/** What a blocked card waits on, in the warning tone. */
function Holds({ todo }: { todo: TaskRecord }): JSX.Element | null {
	const { todos, lanes } = useContext(Board);
	const fix = blockedFix(todo, todos);
	if (fix === null) {
		return null;
	}
	const words =
		fix.kind === "queue"
			? `needs ${fix.chain.map((task) => `#${task.id}`).join(", ")} queued`
			: fix.kind === "drop"
				? `waits on ${fix.lost.map((id) => `#${id}`).join(", ")}, removed`
				: `blocked with #${fix.id}`;
	return (
		<span
			className="text-warning"
			title={fix.kind === "queue" ? chainLines(fix.chain, lanes) : undefined}
		>
			{words}
		</span>
	);
}

import { age } from "@stringsync/splates-server/age";
import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { removeTodo, restoreTodo } from "./api";
import { todoRemoved, todoRestored } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { PHONE_NAME, PHONE_ROW } from "./phone-rows";
import { QueueRowMenu } from "./queue-row-menu";
import { Refusal, useRefusal } from "./refusal";

/**
 * What the queue has yet to start, as `splates queue list` has it: the
 * queued tasks no agent has taken, in the order workers start them, each
 * with how long it has waited, shown even with none so it is plain that
 * nothing waits. Each opens its card on the board; its menu moves it, takes
 * it out of the queue, or leaves it for the person alone to queue.
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
	return (
		<>
			{removed !== null && (
				<p className="flex items-center gap-2 py-1 text-muted-foreground text-sm">
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
				<p className="py-2 text-muted-foreground text-sm">Nothing queued</p>
			) : (
				<ol aria-label="queued tasks" className="flex flex-col">
					{queue.map((todo, place) => (
						<li key={todo.id} className="-mx-2 flex items-center gap-1 px-2">
							<button
								type="button"
								onClick={() => onOpen(todo.id)}
								className={cn(
									"-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
									PHONE_ROW,
								)}
							>
								<span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
									{place + 1}
								</span>
								<span
									className={cn("min-w-0 flex-1 truncate text-sm", PHONE_NAME)}
								>
									{todo.subject}
								</span>
								{todo.manual === true && (
									<span className="shrink-0 text-muted-foreground text-xs">
										manual
									</span>
								)}
								{todo.queuedAt !== undefined && (
									<span
										className="shrink-0 text-muted-foreground text-xs tabular-nums"
										title="How long it has waited in the queue"
									>
										<span className="sr-only">Waiting: </span>
										{age(todo.queuedAt)}
									</span>
								)}
								<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
									#{todo.id}
								</span>
							</button>
							<QueueRowMenu
								todo={todo}
								place={place}
								last={queue.length - 1}
								refuse={refuse}
								onRemove={remove}
							/>
						</li>
					))}
				</ol>
			)}
		</>
	);
}

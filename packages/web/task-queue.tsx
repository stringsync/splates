import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { LoaderCircleIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { removeTodo, restoreTodo } from "./api";
import { todoRemoved, todoRestored } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { useFolded } from "./folded";
import { PHONE_NAME, PHONE_ROW } from "./phone-rows";
import { QueueRowMenu } from "./queue-row-menu";
import { Refusal, useRefusal } from "./refusal";
import { TasksCard } from "./tasks-card";
import { stageOf } from "./todo-queue";

/** Where the Tasks page keeps whether the queue is folded away. */
const FOLDED = "splates.tasks.queue";

/**
 * The queue, as `splates queue list` has it: the queued tasks no agent has
 * taken, in the order workers start them, shown even with none so it is
 * plain that nothing waits. Tasks an agent has taken follow under Running,
 * so a started task stays in view with where it came from. Each opens its
 * card on the board.
 */
export function TaskQueue({
	todos,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	onOpen: (id: number) => void;
}): JSX.Element {
	const { folded, fold } = useFolded(FOLDED);
	const queue = queueOrder(todos);
	const running = todos.filter((todo) => stageOf(todo) === "running");
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
		<TasksCard
			label="queue"
			title="Queue"
			count={queue.length + running.length}
			open={!folded.has("folded")}
			onOpenChange={(open) => fold("folded", open)}
		>
			{running.length > 0 && (
				<ul aria-label="running tasks" className="flex flex-col">
					{running.map((todo) => (
						<li key={todo.id}>
							<button
								type="button"
								onClick={() => onOpen(todo.id)}
								className={cn(
									"-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted",
									PHONE_ROW,
								)}
							>
								<span className="w-5 shrink-0 text-right text-muted-foreground text-xs">
									<LoaderCircleIcon
										aria-hidden
										className="ml-auto size-3 animate-spin"
									/>
								</span>
								<span
									className={cn("min-w-0 flex-1 truncate text-sm", PHONE_NAME)}
								>
									{todo.subject}
								</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									{startedBy(todo)}
								</span>
								<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
									#{todo.id}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
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
				running.length === 0 && (
					<p className="py-2 text-muted-foreground text-sm">Nothing queued</p>
				)
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
		</TasksCard>
	);
}

/** Where a running task came from: who queued it, else the task it came up in, its lane, or by hand. */
function startedBy(todo: TaskRecord): string {
	if (todo.queuedBy?.by === "lane") {
		return `queued by lane ${todo.queuedBy.lane}`;
	}
	if (todo.queuedBy?.by === "person") {
		return "queued by you";
	}
	if (todo.from !== null) {
		return `from ${todo.from}`;
	}
	return todo.lane !== null ? `lane ${todo.lane}` : "By hand";
}

import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@splates/server/board";
import type { QueuedCard as Queued } from "@splates/server/plans/browser";
import { BotIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Board } from "./board";
import { InMessage } from "./card-reply";
import { FinishedReferences } from "./finished-references";
import { useQuotaReserve } from "./quota-reserve";

/** Renders the tasks an agent queued, with a way back to their conversations. */
export const AgentQueuedUI = makeAssistantDataUI<{ queued: Queued }>({
	name: "queued",
	render: ({ data }) => (
		<InMessage>
			<AgentQueuedCard queued={data.queued} />
		</InMessage>
	),
});

export function AgentQueuedCard({ queued }: { queued: Queued }): JSX.Element {
	const board = useContext(Board);
	const finished = useContext(FinishedReferences);
	const holds = useQuotaReserve();
	const count = queued.tasks.length;
	return (
		<div className="@container my-3 rounded-xl border bg-card text-sm">
			<div className="flex flex-col">
				<div className="flex shrink-0 items-center gap-2 rule-b [--rule-inset:0.75rem] px-3 py-2 font-medium text-muted-foreground">
					<BotIcon aria-hidden className="size-4 text-primary" />
					{count} {count === 1 ? "task" : "tasks"} queued
				</div>
				<ul className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_auto] rule-y [--rule-inset:0.75rem]">
					{queued.tasks.map((task) => {
						const todo = board.todos.find((each) => each.id === task.id);
						const saved =
							todo === undefined
								? finished.find(
										(each) =>
											each.id === task.id ||
											each.took.some((taken) => taken.id === task.id),
									)
								: undefined;
						const status =
							todo === undefined
								? null
								: holds[todo.id] === undefined
									? queuedStatus(todo)
									: "waiting: quota reserve";
						return (
							<li
								key={task.id}
								className="col-span-3 grid min-h-11 grid-cols-subgrid items-center gap-x-3 px-3 py-1.5"
							>
								<span className="min-w-0 wrap-anywhere">
									<span className="text-muted-foreground">#{task.id}</span>{" "}
									{task.subject}
								</span>
								<span>
									{status !== null && (
										<Badge variant="secondary">{status}</Badge>
									)}
								</span>
								<span className="justify-self-end">
									{(todo !== undefined || saved !== undefined) && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => {
												const name = todo?.takenBy ?? saved?.task ?? null;
												if (
													board.openQueuedConversation?.(
														task.id,
														name,
														saved?.conversation ?? null,
													)
												) {
													return;
												}
												if (name === null) {
													board.open(task.id);
												} else {
													board.openTask(name);
												}
											}}
										>
											View
										</Button>
									)}
								</span>
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}

function queuedStatus(todo: TaskRecord): string | null {
	if (todo.takenBy !== null) {
		return null;
	}
	return todo.stage === "queued" ? "queued" : "unqueued";
}

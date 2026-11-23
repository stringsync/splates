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
		<div className="@container rounded-xl border bg-card text-sm">
			<div className="flex flex-col @md:flex-row">
				<div className="flex shrink-0 items-center gap-2 rule-b [--rule-inset:0.75rem] px-3 py-2 font-medium text-muted-foreground @md:my-2 @md:border-r @md:border-b-0 @md:bg-none @md:py-0">
					<BotIcon aria-hidden className="size-4 text-primary" />
					{count} {count === 1 ? "task" : "tasks"} queued
				</div>
				<ul className="min-w-0 flex-1 rule-y [--rule-inset:0.75rem]">
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
								className="flex min-h-11 items-center justify-between gap-2 px-3 py-1.5"
							>
								<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
									<span className="min-w-0 wrap-anywhere">
										<span className="text-muted-foreground">#{task.id}</span>{" "}
										{task.subject}
									</span>
									{status !== null && (
										<Badge variant="secondary">{status}</Badge>
									)}
								</div>
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
							</li>
						);
					})}
				</ul>
			</div>
		</div>
	);
}

function queuedStatus(todo: TaskRecord): string {
	if (todo.takenBy !== null) {
		return "running";
	}
	return todo.stage === "queued" ? "queued" : "unqueued";
}

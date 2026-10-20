import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@stringsync/splates-server/board";
import type { QueueProposal } from "@stringsync/splates-server/plans";
import { CheckIcon, ClockIcon, InboxIcon, ListPlusIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { queueLane, queueTodo } from "./api";
import { Board } from "./board";
import { InMessage } from "./card-reply";
import { CardBody, CardShell } from "./card-shell";
import { useExpectSnapshot } from "./expecting";
import { QueueWork } from "./queue-work";
import { Refusal, useRefusal } from "./refusal";
import { stageOf } from "./todo-queue";

/**
 * Renders a `data-queue` part: work an agent added and asks the person to
 * queue, a lane whole or tasks one by one. Agents never queue work, so its
 * Queue now is the person's own write to the board, never a reply the agent
 * acts on, and Later leaves the work where it is on the board.
 */
export const QueueUI = makeAssistantDataUI<{ queue: QueueProposal }>({
	name: "queue",
	render: ({ data }) => (
		<InMessage>
			<QueueCard proposal={data.queue} />
		</InMessage>
	),
});

export function QueueCard({
	proposal,
}: {
	proposal: QueueProposal;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	const { refusal, attempt } = useRefusal();
	// Purely this page's: the work stays on the board, unqueued, either way.
	const [later, setLater] = useState(false);
	const work = new QueueWork(proposal, board);
	const { name, todos, gone } = work;
	const done = work.queued;
	const queueNow = (): void =>
		void attempt(work.queue(expect, { queueLane, queueTodo }), "Not queued");
	return (
		<CardShell
			label={`queue ${name}`}
			Icon={InboxIcon}
			title={proposal.lane === null ? `Queue ${name}` : `Queue lane ${name}`}
			tone={done ? "success" : "info"}
		>
			{proposal.body !== "" && <CardBody text={proposal.body} />}
			{todos.length > 0 && (
				<ul className="flex flex-col gap-1 border-border/60 border-t px-4 py-2.5 text-sm @max-md:px-3">
					{todos.map((todo) => (
						<QueueItem key={todo.id} todo={todo} />
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2 border-border/60 border-t px-4 py-2.5 @max-md:px-3">
				{gone ? (
					<span className="text-muted-foreground text-xs">
						No longer on the board
					</span>
				) : done ? (
					<span className="flex items-center gap-1 text-success text-xs">
						<CheckIcon className="size-3.5" strokeWidth={3} />
						Queued
					</span>
				) : (
					<>
						<Button size="sm" onClick={queueNow} className="gap-1.5">
							<ListPlusIcon data-icon="inline-start" />
							Queue now
						</Button>
						{later ? (
							<span className="text-muted-foreground text-xs">
								Left on the board, to queue when you choose
							</span>
						) : (
							<Button
								size="sm"
								variant="outline"
								onClick={() => setLater(true)}
								className="gap-1.5"
							>
								<ClockIcon data-icon="inline-start" />
								Later
							</Button>
						)}
					</>
				)}
			</div>
			<Refusal refusal={refusal} />
		</CardShell>
	);
}

/** A task the card would queue, which opens it, and where it stands. */
function QueueItem({ todo }: { todo: TaskRecord }): JSX.Element {
	const board = useContext(Board);
	const stage = stageOf(todo);
	return (
		<li className="flex items-baseline gap-2">
			<span className="text-muted-foreground text-xs tabular-nums">
				#{todo.id}
			</span>
			<button
				type="button"
				onClick={() => board.open(todo.id)}
				className="min-w-0 flex-1 cursor-pointer truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				{todo.subject}
			</button>
			<span className="shrink-0 text-muted-foreground text-xs">{stage}</span>
		</li>
	);
}

import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@stringsync/splates-server/board";
import type { QueueProposal } from "@stringsync/splates-server/plans";
import { InboxIcon, ListPlusIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { ActionCard } from "./action-card";
import { queueLane, queueTodo } from "./api";
import { Board } from "./board";
import { InMessage } from "./card-reply";
import { useExpectSnapshot } from "./expecting";
import { QueueWork } from "./queue-work";
import { stageOf } from "./todo-queue";

/**
 * Renders a `data-queue` part: work an agent added and asks the person to
 * queue, a lane whole or tasks one by one. Agents never queue work, so its
 * Queue now is the person's own write to the board, never a reply the agent
 * acts on, as is the command it gives to run in a terminal instead; Later
 * leaves the work where it is on the board.
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
	const work = new QueueWork(proposal, board);
	const { name, todos } = work;
	return (
		<ActionCard
			label={`queue ${name}`}
			Icon={InboxIcon}
			title={proposal.lane === null ? `Queue ${name}` : `Queue lane ${name}`}
			body={proposal.body}
			action={{
				verb: "Queue now",
				VerbIcon: ListPlusIcon,
				done: "Queued",
				command: work.command,
				run: () => work.queue(expect, { queueLane, queueTodo }),
				failed: "Not queued",
			}}
			done={work.queued}
			gone={work.gone ? "No longer on the board" : null}
		>
			{todos.length > 0 && (
				<ul className="flex flex-col gap-1 border-border/60 border-t px-4 py-2.5 text-sm @max-md:px-3">
					{todos.map((todo) => (
						<QueueItem key={todo.id} todo={todo} />
					))}
				</ul>
			)}
		</ActionCard>
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

import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@stringsync/splates-server/board";
import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { InboxIcon, ListPlusIcon, Trash2Icon } from "lucide-react";
import { type JSX, useContext } from "react";
import { ActionCard } from "./action-card";
import { dropLane, queueLane, queueTodo } from "./api";
import { Board } from "./board";
import { laneDropped } from "./board-expectations";
import { InMessage } from "./card-reply";
import { useExpectSnapshot } from "./expecting";
import { QueueWork } from "./queue-work";
import { stageOf } from "./todo-queue";

/**
 * Renders a `data-permission` part: something an agent asks the person to
 * allow because splates refuses it an agent: queue work, a lane whole or
 * tasks one by one, or remove a lane with its tasks. Its button is the
 * person's own write to the board, never a reply the agent acts on, as is the
 * command it gives to run in a terminal instead; Later leaves things as they
 * are.
 */
export const PermissionUI = makeAssistantDataUI<{
	permission: PermissionProposal;
}>({
	name: "permission",
	render: ({ data }) => (
		<InMessage>
			<PermissionCard proposal={data.permission} />
		</InMessage>
	),
});

export function PermissionCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	return proposal.action === "remove-lane" ? (
		<RemoveLaneCard proposal={proposal} />
	) : (
		<QueueCard proposal={proposal} />
	);
}

/** Removing a lane with its tasks, which are kept to restore. */
function RemoveLaneCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	const id = proposal.lane as number;
	const lane = board.lanes.find((each) => each.id === id) ?? null;
	const name = lane?.name ?? proposal.title ?? `lane ${id}`;
	const todos = board.todos.filter((todo) => todo.lane === id);
	return (
		<ActionCard
			label={`remove ${name}`}
			Icon={Trash2Icon}
			title={`Remove lane ${name}`}
			body={proposal.body}
			action={{
				verb: "Remove now",
				VerbIcon: Trash2Icon,
				done: "Removed",
				command: `splates lane remove ${id}`,
				run: () => expect(laneDropped(id), dropLane(id)),
				failed: "Not removed",
			}}
			done={board.linked && lane === null}
			gone={null}
		>
			<p className="border-border/60 border-t px-4 py-2.5 text-sm @max-md:px-3">
				{todos.length === 0
					? "No tasks go with it."
					: todos.length === 1
						? "Its 1 task goes with it."
						: `Its ${todos.length} tasks go with it.`}
			</p>
		</ActionCard>
	);
}

function QueueCard({
	proposal,
}: {
	proposal: PermissionProposal;
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

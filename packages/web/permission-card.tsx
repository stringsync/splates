import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@stringsync/splates-server/board";
import type { PermissionProposal } from "@stringsync/splates-server/plans";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import {
	HandIcon,
	HourglassIcon,
	ListPlusIcon,
	type LucideIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { ActionCard } from "./action-card";
import { dropLane, queueLane, queueTodo } from "./api";
import { Board } from "./board";
import { laneDropped } from "./board-expectations";
import { InMessage } from "./card-reply";
import { Dispatching } from "./dispatching";
import { EvalsCard } from "./evals-card";
import { useExpectSnapshot } from "./expecting";
import { QueueWork } from "./queue-work";
import { RunCommandCard } from "./run-command-card";
import { stageOf } from "./todo-queue";

/**
 * Renders a `data-permission` part: something an agent asks the person to
 * allow because splates refuses it an agent: queue work, a lane whole or
 * tasks one by one, remove a lane with its tasks, run evals or the whole
 * test suite. Its button is the
 * person's own write to the board, never a reply the agent acts on, as is the
 * command it gives to run in a terminal instead.
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
	switch (proposal.action) {
		case "remove-lane":
			return <RemoveLaneCard proposal={proposal} />;
		case "run-evals":
			return <EvalsCard proposal={proposal} />;
		case "run-command":
			return <RunCommandCard proposal={proposal} />;
		case "queue":
			return <QueueCard proposal={proposal} />;
	}
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
	const done = board.linked && lane === null;
	return (
		<ActionCard
			label={`remove ${name}`}
			Icon={Trash2Icon}
			title={done ? `Removed lane ${name}` : `Remove lane ${name}`}
			body={proposal.body}
			action={{
				verb: "Remove now",
				VerbIcon: Trash2Icon,
				done: "Removed",
				command: `splates lane remove ${id}`,
				run: () => expect(laneDropped(id), dropLane(id)),
				failed: "Not removed",
			}}
			done={done}
			gone={null}
			note={todos.length === 0 ? undefined : "Its tasks are kept to restore."}
			tone="destructive"
		>
			{!done && (
				<Panel
					heading={
						todos.length === 0
							? "No tasks go with it."
							: todos.length === 1
								? "Its 1 task goes with it."
								: `Its ${todos.length} tasks go with it.`
					}
				>
					{todos.map((todo) => (
						<Row
							key={todo.id}
							todo={todo}
							Icon={Trash2Icon}
							status={stageOf(todo)}
							tone="destructive"
						/>
					))}
				</Panel>
			)}
		</ActionCard>
	);
}

/** The queued work above the card's own that the panel shows, the rest counted. */
const AHEAD = 3;

/**
 * Queuing a lane whole or tasks one by one, shown where it lands: the
 * queue as it stands, then the card's tasks joining it.
 */
function QueueCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const board = useContext(Board);
	const dispatching = useContext(Dispatching);
	const expect = useExpectSnapshot();
	const work = new QueueWork(proposal, board);
	const { name, todos } = work;
	const mine = new Set(todos.map((todo) => todo.id));
	const queue = queueOrder(board.todos);
	const ahead = queue.filter((todo) => !mine.has(todo.id));
	// Running means an agent is on the task that took it: not one whose
	// conversation is gone, nor a taker the page no longer lists.
	const running = board.todos.filter(
		(todo) =>
			todo.takenBy !== null &&
			!mine.has(todo.id) &&
			board.tasks.includes(todo.takenBy) &&
			!dispatching?.dispatch.orphaned(todo.takenBy),
	).length;
	const hidden = Math.max(0, ahead.length - AHEAD);
	const shown = ahead.slice(hidden);
	const aheadRow = (todo: TaskRecord) => (
		<Row
			key={todo.id}
			todo={todo}
			Icon={HourglassIcon}
			status={`queued · ${queue.indexOf(todo) + 1}`}
			tone="quiet"
		/>
	);
	const whole = proposal.lane !== null;
	const what = whole ? `lane ${name}` : name;
	return (
		<ActionCard
			label={`queue ${name}`}
			Icon={TriangleAlertIcon}
			title={work.queued ? `Queued ${what}` : `Add ${what} to the queue`}
			body={proposal.body}
			action={{
				verb: whole
					? "Queue lane"
					: todos.length === 1
						? "Queue task"
						: `Queue ${todos.length} tasks`,
				VerbIcon: ListPlusIcon,
				done: "Queued",
				command: work.command,
				run: () => work.queue(expect, { queueLane, queueTodo }),
				failed: "Not queued",
			}}
			done={work.queued}
			gone={work.gone ? "No longer on the board" : null}
			note={whole ? "Each task joins once nothing blocks it." : undefined}
			tone="warning"
		>
			{todos.length > 0 && (
				<Panel>
					{running > 0 && <Line Icon={HourglassIcon}>{running} running</Line>}
					{hidden > 0 && (
						<Line Icon={HourglassIcon}>{hidden} more queued ahead</Line>
					)}
					{shown.filter((todo) => todo.manual !== true).map(aheadRow)}
					{shown.some((todo) => todo.manual === true) && (
						<Line Icon={HandIcon}>By hand</Line>
					)}
					{shown.filter((todo) => todo.manual === true).map(aheadRow)}
					{todos.map((todo) => (
						<QueueItem key={todo.id} todo={todo} queue={queue} whole={whole} />
					))}
				</Panel>
			)}
		</ActionCard>
	);
}

/**
 * One of the card's tasks: where it stands once it is queued or running,
 * otherwise that it joins, or for a lane's, after what blocks it.
 */
function QueueItem({
	todo,
	queue,
	whole,
}: {
	todo: TaskRecord;
	queue: readonly TaskRecord[];
	whole: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const stage = stageOf(todo);
	if (stage === "running") {
		return (
			<Row todo={todo} Icon={HourglassIcon} status="running" tone="quiet" />
		);
	}
	if (stage === "queued") {
		return (
			<Row
				todo={todo}
				Icon={HourglassIcon}
				status={`queued · ${queue.findIndex((each) => each.id === todo.id) + 1}`}
				tone="quiet"
			/>
		);
	}
	// A queued lane queues a task once nothing open blocks it.
	const blocker = whole
		? todo.blockedBy.find((id) => board.todos.some((each) => each.id === id))
		: undefined;
	return (
		<Row
			todo={todo}
			Icon={ListPlusIcon}
			status={blocker === undefined ? "joins" : `after #${blocker}`}
			tone="plain"
		/>
	);
}

/**
 * The work a card acts on, its rows running the card's width under its body,
 * a heading over them when there is one.
 */
function Panel({
	heading,
	children,
}: {
	heading?: string;
	children?: ReactNode;
}): JSX.Element {
	return (
		<div className="border-t text-sm">
			{heading !== undefined && (
				<p className="px-4 pt-2.5 pb-1 text-muted-foreground text-xs @max-md:px-3">
					{heading}
				</p>
			)}
			<ul>{children}</ul>
		</div>
	);
}

/** A line of the panel that stands for several tasks it leaves out. */
function Line({
	Icon,
	children,
}: {
	Icon: LucideIcon;
	children: ReactNode;
}): JSX.Element {
	return (
		<li className="flex items-center gap-2 border-t px-4 py-1.5 text-muted-foreground text-xs first:border-t-0 @max-md:px-3">
			<Icon className="size-3.5" />
			{children}
		</li>
	);
}

const ROW_TONES = {
	quiet: { row: "text-muted-foreground", icon: "", status: "" },
	plain: {
		row: "",
		icon: "text-muted-foreground",
		status: "text-muted-foreground",
	},
	destructive: {
		row: "border-destructive/30 bg-destructive/[0.05]",
		icon: "text-destructive",
		status: "text-destructive",
	},
};

/** A task in the panel, which opens it, and where it stands. */
function Row({
	todo,
	Icon,
	status,
	tone,
}: {
	todo: TaskRecord;
	Icon: LucideIcon;
	status: string;
	tone: keyof typeof ROW_TONES;
}): JSX.Element {
	const board = useContext(Board);
	const { row, icon, status: toned } = ROW_TONES[tone];
	return (
		<li
			className={cn(
				"flex items-center gap-2 border-t px-4 py-1.5 first:border-t-0 @max-md:px-3",
				row,
			)}
		>
			<Icon className={cn("size-3.5 shrink-0", icon)} />
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
			<span className={cn("shrink-0 text-xs", toned)}>{status}</span>
		</li>
	);
}

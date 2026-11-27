import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@splates/server/board";
import type {
	QueuedCard as Queued,
	QueuedLane,
} from "@splates/server/plans/browser";
import { BotIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { Board } from "./board";
import { InMessage } from "./card-reply";
import { SLIM_BAR, useQueuedTree } from "./chain-card";
import { FinishedReferences } from "./finished-references";
import { useQuotaReserve } from "./quota-reserve";

/** Renders the tasks or lane an agent queued, with a way back to their conversations. */
export const AgentQueuedUI = makeAssistantDataUI<{ queued: Queued }>({
	name: "queued",
	render: ({ data }) => (
		<InMessage>
			<AgentQueuedCard queued={data.queued} />
		</InMessage>
	),
});

/**
 * What an agent queued on its own, as one slim bar per task under a caption
 * naming the lane, with the robot that marks it the agent's doing.
 */
export function AgentQueuedCard({ queued }: { queued: Queued }): JSX.Element {
	if (queued.lane !== undefined) {
		return <AgentQueuedLaneCard queuedLane={queued.lane} />;
	}
	return (
		<QueuedBars
			label="auto-queued tasks"
			caption={
				queued.tasks.length === 1 ? "Auto-queued task" : "Auto-queued tasks"
			}
			tasks={queued.tasks}
		/>
	);
}

function AgentQueuedLaneCard({
	queuedLane,
}: {
	queuedLane: QueuedLane;
}): JSX.Element {
	const board = useContext(Board);
	const lane = board.lanes.find((each) => each.id === queuedLane.id) ?? null;
	const name = lane?.name ?? queuedLane.name;
	const todos = board.todos.filter((each) => each.lane === queuedLane.id);
	return (
		<QueuedBars
			label={`auto-queued lane ${queuedLane.id}`}
			caption={
				<>
					Auto-queued lane{" "}
					<span className="font-semibold text-foreground">
						{name === "" ? queuedLane.id : name}
					</span>
				</>
			}
			onBoard={lane === null ? null : () => board.openLane(queuedLane.id)}
			tasks={todos}
			empty="No open tasks left in this lane."
		/>
	);
}

/** A caption with the lane's links over one slim bar for each of `tasks`. */
function QueuedBars({
	label,
	caption,
	onBoard = null,
	tasks,
	empty,
}: {
	label: string;
	caption: ReactNode;
	onBoard?: (() => void) | null;
	tasks: readonly { id: number; subject: string }[];
	empty?: string;
}): JSX.Element {
	const ids = tasks.map((task) => task.id);
	const { arrived, openTree } = useQueuedTree(ids);
	const link = (text: string, onClick: () => void) => (
		<>
			{" · "}
			<button
				type="button"
				className="cursor-pointer text-foreground underline underline-offset-2"
				onClick={onClick}
			>
				{text}
			</button>
		</>
	);
	return (
		<section
			aria-label={label}
			className="my-4"
			data-queued-tasks={ids.join(",")}
		>
			<p className="mb-1.5 px-1 text-muted-foreground text-sm">
				{caption}
				{onBoard !== null && link("Board", onBoard)}
				{openTree !== null && link("View", openTree)}
			</p>
			{tasks.length > 0 ? (
				<ul className="flex flex-col gap-1.5">
					{tasks.map((task) => (
						<QueuedTaskBar
							key={task.id}
							id={task.id}
							subject={task.subject}
							ringed={arrived}
						/>
					))}
				</ul>
			) : (
				<p className="px-1 text-muted-foreground text-sm">{empty}</p>
			)}
		</section>
	);
}

/**
 * A queued task as one slim bar: its subject opening its conversation, or the
 * board while none has it, and where it stands.
 */
function QueuedTaskBar({
	id,
	subject,
	ringed,
}: {
	id: number;
	subject: string;
	ringed: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const finished = useContext(FinishedReferences);
	const holds = useQuotaReserve();
	const todo = board.todos.find((each) => each.id === id);
	const saved =
		todo === undefined
			? finished.find(
					(each) =>
						each.id === id || each.took.some((taken) => taken.id === id),
				)
			: undefined;
	const open =
		todo === undefined && saved === undefined
			? null
			: () => {
					const name = todo?.takenBy ?? saved?.task ?? null;
					if (
						board.openQueuedConversation?.(
							id,
							name,
							saved?.conversation ?? null,
						)
					) {
						return;
					}
					if (name === null) {
						board.open(id);
					} else {
						board.openTask(name);
					}
				};
	const status =
		todo === undefined
			? null
			: holds[todo.id] === undefined
				? queuedStatus(todo)
				: "waiting: quota reserve";
	return (
		<li
			data-queued-task={id}
			className={cn(SLIM_BAR, ringed && "ring-2 ring-primary/60")}
		>
			<BotIcon aria-hidden className="size-4 shrink-0 text-primary" />
			<span className="shrink-0 text-muted-foreground tabular-nums">#{id}</span>
			{open === null ? (
				<span className="min-w-0 flex-1 truncate">{subject}</span>
			) : (
				<span className="flex min-w-0 flex-1">
					<button
						type="button"
						onClick={open}
						className="min-w-0 cursor-pointer truncate rounded text-left underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{subject}
					</button>
				</span>
			)}
			{status !== null && (
				<span className="shrink-0 text-muted-foreground text-xs">{status}</span>
			)}
		</li>
	);
}

function queuedStatus(todo: TaskRecord): string {
	if (todo.takenBy !== null) {
		return "running";
	}
	return todo.stage === "queued" ? "queued" : "unqueued";
}

import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@splates/server/board";
import type { PermissionProposal } from "@splates/server/plans";
import type { Snapshot } from "@splates/server/tasks";
import {
	CircleCheckIcon,
	HourglassIcon,
	ListPlusIcon,
	type LucideIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { ActionCard } from "./action-card";
import { answered, dropLane, queueLane, queueTodo, scoped } from "./api";
import { Board } from "./board";
import { laneDropped } from "./board-expectations";
import { InMessage } from "./card-reply";
import { EvalsCard } from "./evals-card";
import { type SnapshotExpecter, useExpectSnapshot } from "./expecting";
import { GrantCard } from "./grant-card";
import { NavigationContext, useShownProject } from "./navigation";
import { placeKey } from "./project-places";
import { QueueWork } from "./queue-work";
import { RunCommandCard } from "./run-command-card";
import { stageOf } from "./todo-queue";

/**
 * Shows what an agent asks you to allow, such as queueing work, removing a
 * lane with its tasks, running evals or the whole test suite. Pressing its
 * button is your own action; the agent never acts on it as a reply.
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
		case "grant":
			return <GrantCard proposal={proposal} />;
		default:
			// Nothing draws a card for an action the web no longer knows.
			return <></>;
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
							onOpen={board.open}
						/>
					))}
				</Panel>
			)}
		</ActionCard>
	);
}

/**
 * Queuing a lane whole or tasks one by one, in this project or, as the card
 * names one, another.
 */
function QueueCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	// The bare address shows the focused project, which its snapshot names.
	const shown = placeKey(useShownProject());
	return proposal.project === undefined || proposal.project === shown ? (
		<OwnQueueCard proposal={proposal} />
	) : (
		<OtherQueueCard proposal={proposal} project={proposal.project} />
	);
}

/**
 * Queuing tasks of another project's, read from its own snapshot, and again
 * once queued: where they land in its queue, each opening its board.
 */
function OtherQueueCard({
	proposal,
	project,
}: {
	proposal: PermissionProposal;
	project: string;
}): JSX.Element {
	const navigation = useContext(NavigationContext);
	const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
	const read = useCallback(async () => {
		const response = await answered(scoped("/api/snapshot", project));
		if (response.ok) {
			setSnapshot((await response.json()) as Snapshot);
		}
	}, [project]);
	useEffect(() => {
		void read().catch(() => {});
	}, [read]);
	const work = new QueueWork(proposal, {
		linked: snapshot !== null,
		lanes: snapshot?.lanes ?? [],
		todos: snapshot?.todos ?? [],
	});
	// Shown at once on the snapshot read, then read again either way.
	const expect: SnapshotExpecter["expect"] = async (expectation, write) => {
		setSnapshot((now) => (now === null ? now : expectation(now)));
		try {
			await write;
		} finally {
			await read().catch(() => {});
		}
	};
	const { name, todos } = work;
	return (
		<ActionCard
			label={`queue ${project} ${name}`}
			Icon={work.queued ? CircleCheckIcon : TriangleAlertIcon}
			title={
				work.queued
					? `Queued ${project} ${name}`
					: `Add ${project} ${name} to its queue`
			}
			body={proposal.body}
			action={{
				verb: todos.length === 1 ? "Queue task" : `Queue ${todos.length} tasks`,
				VerbIcon: ListPlusIcon,
				done: "Queued",
				command: work.command,
				run: () =>
					work.queue(expect, {
						// A card names another project's tasks, never its lane.
						queueLane: () => Promise.reject(new Error(`not ${project}'s lane`)),
						queueTodo: (id, queued) => queueTodo(id, queued, project),
					}),
				failed: "Not queued",
			}}
			done={snapshot !== null && !work.gone && work.queued}
			gone={work.gone ? `No longer on ${project}'s board` : null}
			tone="warning"
		>
			{todos.length > 0 && snapshot !== null && (
				<QueuePanel
					todos={todos}
					board={snapshot.todos}
					whole={false}
					onOpen={(id) => navigation.show(todoUrl(project, id))}
				/>
			)}
		</ActionCard>
	);
}

/**
 * Queuing a lane's tasks or tasks one by one of this project's, shown where
 * it lands: the queue as it stands, then the card's tasks joining it.
 */
function OwnQueueCard({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	const work = new QueueWork(proposal, board);
	const { name, todos } = work;
	const whole = proposal.lane !== null;
	const what = whole ? `lane ${name}` : name;
	return (
		<ActionCard
			label={`queue ${name}`}
			Icon={work.queued ? CircleCheckIcon : TriangleAlertIcon}
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
			note={
				whole ? "Each task starts once what it is blocked by lands." : undefined
			}
			tone="warning"
		>
			{todos.length > 0 && (
				<QueuePanel
					todos={todos}
					board={board.todos}
					whole={whole}
					onOpen={board.open}
				/>
			)}
		</ActionCard>
	);
}

/** Another project's board at the todo `id`, as a link on its page opens one. */
function todoUrl(project: string, id: number): string {
	const url = new URL(location.href);
	url.searchParams.set("project", project);
	url.hash = `#todos/${id}`;
	return url.toString();
}

/**
 * The card's `todos`, each saying only what holds it back: nothing, when it
 * starts at once.
 */
function QueuePanel({
	todos,
	board,
	whole,
	onOpen,
}: {
	todos: readonly TaskRecord[];
	board: readonly TaskRecord[];
	whole: boolean;
	onOpen: (id: number) => void;
}): JSX.Element {
	return (
		<Panel>
			{todos.map((todo) => (
				<QueueItem
					key={todo.id}
					todo={todo}
					board={board}
					whole={whole}
					onOpen={onOpen}
				/>
			))}
		</Panel>
	);
}

/** One of the card's tasks, with a status only when it is not ready to start: queued, running, or what it waits for. */
function QueueItem({
	todo,
	board,
	whole,
	onOpen,
}: {
	todo: TaskRecord;
	board: readonly TaskRecord[];
	whole: boolean;
	onOpen: (id: number) => void;
}): JSX.Element {
	const stage = stageOf(todo);
	if (stage === "running" || stage === "queued") {
		return (
			<Row
				todo={todo}
				Icon={HourglassIcon}
				status={stage}
				tone="quiet"
				onOpen={onOpen}
			/>
		);
	}
	// It waits on a blocker the queue will start, its lane's or one queued or
	// running; the queue lets it go for one it will not.
	const blocker = whole
		? board.find((each) => todo.blockedBy.includes(each.id))
		: undefined;
	const starts =
		blocker === undefined ||
		blocker.lane === todo.lane ||
		blocker.stage === "queued" ||
		blocker.stage === "running";
	return (
		<Row
			todo={todo}
			Icon={ListPlusIcon}
			status={
				blocker === undefined
					? undefined
					: starts
						? `waits for #${blocker.id}`
						: `left out: queue #${blocker.id} first`
			}
			tone="plain"
			onOpen={onOpen}
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

/**
 * A task in the panel, which `onOpen` opens, and where it stands.
 */
function Row({
	todo,
	Icon,
	status,
	tone,
	onOpen,
}: {
	todo: TaskRecord;
	Icon: LucideIcon;
	/** Left off for a task with nothing to say. */
	status?: string;
	tone: keyof typeof ROW_TONES;
	onOpen: (id: number) => void;
}): JSX.Element {
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
				onClick={() => onOpen(todo.id)}
				className="min-w-0 flex-1 cursor-pointer truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
			>
				{todo.subject}
			</button>
			{status !== undefined && (
				<span className={cn("shrink-0 text-xs", toned)}>{status}</span>
			)}
		</li>
	);
}

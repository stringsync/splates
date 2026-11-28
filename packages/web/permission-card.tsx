import { makeAssistantDataUI } from "@assistant-ui/react";
import type { TaskRecord } from "@splates/server/board";
import type { PermissionProposal } from "@splates/server/plans";
import type { Snapshot } from "@splates/server/tasks";
import {
	CircleCheckIcon,
	HourglassIcon,
	ListPlusIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useCallback, useContext, useEffect, useState } from "react";
import { ActionCard } from "./action-card";
import { answered, queueLane, queueTodo, scoped } from "./api";
import { Board } from "./board";
import { InMessage } from "./card-reply";
import { Panel, Row } from "./card-task-rows";
import {
	type SnapshotExpecter,
	useExpectSnapshot,
	usePendingAny,
} from "./expecting";
import { NavigationContext, useShownProject } from "./navigation";
import { placeKey } from "./project-places";
import { reasonOf } from "./queue-reason";
import { QueueWork } from "./queue-work";
import { RunCommandCard } from "./run-command-card";
import { SplatesEvent } from "./splates-event";
import { QueueToggle, stageOf } from "./todo-queue";

/**
 * Shows what an agent asks you to allow, such as queueing work or running the
 * whole test suite. Pressing its button is your own action; the agent never
 * acts on it as a reply.
 */
export const PermissionUI = makeAssistantDataUI<{
	permission: PermissionProposal;
	superseded?: boolean;
}>({
	name: "permission",
	render: ({ data }) =>
		data.superseded === true ? (
			<SupersededQueue proposal={data.permission} />
		) : (
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
		case "run-command":
			return <RunCommandCard proposal={proposal} />;
		case "queue":
			return <QueueCard proposal={proposal} />;
	}
}

/**
 * A queue card for a lane that a later one for the same lane supplants,
 * folded to an event line: what it asked, the lane as a chip.
 */
function SupersededQueue({
	proposal,
}: {
	proposal: PermissionProposal;
}): JSX.Element {
	const work = new QueueWork(proposal, useContext(Board));
	return (
		<SplatesEvent
			event={{
				words: [
					work.queued ? "Queued" : "Asked to queue",
					{ kind: "lane", id: proposal.lane as number, name: work.name },
				],
			}}
		/>
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
	const { reason, rest } = reasonOf(proposal.body);
	return (
		<ActionCard
			label={`queue ${project} ${name}`}
			Icon={work.queued ? CircleCheckIcon : TriangleAlertIcon}
			title={
				work.queued
					? `Queued ${project} ${name}`
					: `Add ${project} ${name} to its queue`
			}
			body={rest}
			reason={reason}
			action={{
				verb: todos.length === 1 ? "Queue task" : `Queue ${todos.length} tasks`,
				VerbIcon: ListPlusIcon,
				done: "Queued",
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
					ruled={rest !== "" || reason !== null}
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
export function OwnQueueCard({
	proposal,
	perTask = false,
}: {
	proposal: PermissionProposal;
	/** Gives each task its own queue button beside the card's Queue all. */
	perTask?: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	const work = new QueueWork(proposal, board);
	const settling = usePendingAny(work.keys);
	const { name, todos } = work;
	const whole = proposal.lane !== null;
	const what = whole ? `lane ${name}` : name;
	const { reason, rest } = reasonOf(proposal.body);
	return (
		<ActionCard
			label={`queue ${name}`}
			Icon={work.queued ? CircleCheckIcon : TriangleAlertIcon}
			title={work.queued ? `Queued ${what}` : `Add ${what} to the queue`}
			body={rest}
			reason={reason}
			action={{
				verb: whole
					? "Queue lane"
					: todos.length === 1
						? "Queue task"
						: `Queue ${todos.length} tasks`,
				VerbIcon: ListPlusIcon,
				done: "Queued",
				run: () => work.queue(expect, { queueLane, queueTodo }),
				failed: "Not queued",
			}}
			done={work.queued}
			settling={settling}
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
					ruled={rest !== "" || reason !== null}
					onOpen={board.open}
					perTask={perTask}
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
	ruled = true,
	onOpen,
	perTask = false,
}: {
	todos: readonly TaskRecord[];
	board: readonly TaskRecord[];
	whole: boolean;
	ruled?: boolean;
	onOpen: (id: number) => void;
	perTask?: boolean;
}): JSX.Element {
	return (
		<Panel ruled={ruled}>
			{todos.map((todo) => (
				<QueueItem
					key={todo.id}
					todo={todo}
					board={board}
					whole={whole}
					onOpen={onOpen}
					perTask={perTask}
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
	perTask,
}: {
	todo: TaskRecord;
	board: readonly TaskRecord[];
	whole: boolean;
	onOpen: (id: number) => void;
	perTask: boolean;
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
				after={perTask && <QueueToggle todo={todo} />}
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
			after={perTask && <QueueToggle todo={todo} />}
		/>
	);
}

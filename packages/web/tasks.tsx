import { age } from "@stringsync/splates-server/age";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import { type Needing, needs } from "@stringsync/splates-server/plans/browser";
import type { Details, Snapshot } from "@stringsync/splates-server/tasks";
import { useDisposerEffect, useReactive } from "@webappwiz/react";
import { type JSX, useContext } from "react";
import { Duration } from "webappwiz/time";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { Badge } from "./components/ui/badge";
import { reportedAs } from "./conversation-names";
import { Dispatching, OnIt } from "./dispatching";
import { useEverywhere } from "./everywhere-context";
import type { EverywhereSummary, InProject } from "./everywhere-feed";
import { FinishedTasks } from "./finished-tasks";
import { useNow } from "./hooks/use-now";
import { Orphaned } from "./list-rows";
import { localWorker } from "./local-worker";
import { useMachine } from "./machine";
import { Mark } from "./mark";
import { NavigationContext } from "./navigation";
import { useReading } from "./page-readings";
import { QueueControls } from "./queue-controls";
import { QueuedLanes } from "./queue-lanes";
import { QueueEmpty, QueueRow, QueueSection } from "./queue-rows";
import { Running, useKnown, Waiting } from "./queue-running";
import { QueueMark } from "./slot-queue";
import { Task } from "./task-dialog";
import { UpNext } from "./task-queue";
import { TopBar } from "./top-bar";
import { WorkerPoolView } from "./worker-pool";

/**
 * The Queue page: atop it, Pause and how many agents run at once; then one
 * card of all the queue holds, the agents holding a slot (Running), those
 * waiting for one, the queued tasks yet to start (Up next), the lanes queued
 * whole, and every other task at work (Started by you), a line each, from
 * every project. Where a task stands in splates waits behind a tap; another
 * project's opens on that project's page. Finished's card follows.
 */
export function Tasks({
	project,
	open,
	onOpen,
	onOpenTodo,
	onOpenLane,
}: {
	/** This project, as its snapshot has it, to find among every project the feed lists. */
	project: Here;
	/** The task whose dialog is open, by name, so it follows the task as the page reads it again. */
	open: string | null;
	onOpen: (task: string | null) => void;
	/** Opens queued task `id` on the board. */
	onOpenTodo: (id: number) => void;
	/** Opens lane `id` on the board. */
	onOpenLane: (id: number) => void;
}): JSX.Element {
	const { tasks } = project;
	const opened = tasks.find((task) => task.task === open) ?? null;
	const view = useReading("workers", () => new WorkerPoolView());
	useDisposerEffect((disposer) => disposer.use(view.watch()), [view]);
	const { pool } = useReactive(view, ({ pool }) => ({ pool }), ["changed"]);
	const machine = useMachine();
	const known = useKnown(project.root);
	const held = pool?.held ?? [];
	const queue = machine?.queue ?? [];
	// A task whose agent holds a slot shows under Running, not again below.
	const slotted = new Set(
		held.flatMap((each) =>
			each.capped && each.task !== null
				? [`${each.project}\n${each.task}`]
				: [],
		),
	);
	const groups = useGroups(project, slotted);
	const yours =
		groups === null
			? tasks.filter((task) => !slotted.has(`${project.root}\n${task.task}`))
					.length
			: groups.reduce((sum, group) => sum + group.tasks.length, 0);
	useNow(yours + held.length > 0, Duration.mins(1));

	return (
		<section aria-label="queue" className="flex flex-col gap-4">
			<TopBar title="Queue" />
			{pool !== null && (
				<QueueControls
					view={view}
					pool={pool}
					waiting={queue.filter((entry) => entry.queued !== true).length}
				/>
			)}
			<section
				aria-label="queue card"
				className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
			>
				<Running
					held={held}
					total={
						pool === null ? null : (localWorker(pool)?.slots.total ?? null)
					}
					known={known}
				/>
				<Waiting queue={queue} known={known} />
				<UpNext todos={project.todos} onOpen={onOpenTodo} />
				<QueuedLanes
					lanes={project.lanes}
					todos={project.todos}
					onOpen={onOpenLane}
				/>
				<QueueSection title="Started by you" count={yours}>
					{groups === null ? (
						<TaskRows
							rows={tasks.filter(
								(task) => !slotted.has(`${project.root}\n${task.task}`),
							)}
							onOpen={onOpen}
						/>
					) : (
						<ProjectRows groups={groups} onOpen={onOpen} />
					)}
				</QueueSection>
			</section>
			<FinishedTasks moved={tasks.map((task) => task.task).join("\n")} />
			<Dialog
				open={opened !== null}
				onOpenChange={(opening) => {
					if (!opening) {
						onOpen(null);
					}
				}}
			>
				{opened && <Task task={opened} />}
			</Dialog>
		</section>
	);
}

/** What the Tasks page reads of this project's snapshot. */
type Here = Pick<Snapshot, "tasks" | "todos" | "lanes" | "root" | "repo">;

/** One project's tasks on the Tasks page. */
interface Group {
	/** Its slug, as `?project=` names it; null for this one, unlisted yet. */
	project: string | null;
	/** Its repository's name, as its page heads itself. */
	name: string;
	/** Its main tree. */
	root: string;
	/** Whether it is the project this page shows. */
	here: boolean;
	tasks: Details[];
	/**
	 * What each conversation on its tasks needs, for another project's, whose
	 * `Dispatching` this page does not hold; null for this one.
	 */
	needing: Needing[] | null;
}

/**
 * Every project with tasks, as `groupsOf` gathers them, null while the feed
 * of every project is not to be had, loading or refused, when the page lists
 * this one's alone.
 */
function useGroups(here: Here, slotted: ReadonlySet<string>): Group[] | null {
	const feed = useEverywhere(
		({ available, projects, tasks, conversations }) => ({
			available,
			projects,
			tasks,
			conversations,
		}),
	);
	return feed.available
		? groupsOf(feed.projects, feed.tasks, feed.conversations, here).map(
				(group) => ({
					...group,
					tasks: group.tasks.filter(
						(task) => !slotted.has(`${group.root}\n${task.task}`),
					),
				}),
			)
		: null;
}

/**
 * Every project with tasks, by name, this one's tasks as its snapshot has
 * them, which its dialog reads too. This one is listed even with none, so
 * the page still shows where its tasks will go.
 */
function groupsOf(
	projects: EverywhereSummary[],
	everywhere: InProject<Details>[],
	conversations: InProject<ConversationState>[],
	here: Here,
): Group[] {
	const listed = projects.map((project): Group => {
		if (project.root === here.root) {
			return {
				project: project.project,
				name: here.repo,
				root: here.root,
				here: true,
				tasks: here.tasks,
				needing: null,
			};
		}
		const tasks = everywhere.filter((task) => task.project === project.project);
		const its = conversations.filter(
			(conversation) => conversation.project === project.project,
		);
		return {
			project: project.project,
			name: project.repo,
			root: project.root,
			here: false,
			tasks,
			needing: needs({ tasks, conversations: its }),
		};
	});
	if (!listed.some((group) => group.here)) {
		listed.push({
			project: null,
			name: here.repo,
			root: here.root,
			here: true,
			tasks: here.tasks,
			needing: null,
		});
	}
	return listed
		.filter((group) => group.here || group.tasks.length > 0)
		.sort(
			(one, other) =>
				one.name.localeCompare(other.name) ||
				(one.project ?? "").localeCompare(other.project ?? ""),
		);
}

/**
 * Every project's tasks at work, a row each, another project's named on its
 * row and opened on its project's page, at the task.
 */
function ProjectRows({
	groups,
	onOpen,
}: {
	groups: Group[];
	onOpen: (task: string) => void;
}): JSX.Element {
	const navigation = useContext(NavigationContext);
	const rows = groups.flatMap((group) =>
		group.tasks.map((task) => ({ group, task })),
	);
	if (rows.length === 0) {
		return <QueueEmpty>No tasks at work</QueueEmpty>;
	}
	return (
		<ul
			aria-label="task list"
			className="flex flex-col divide-y divide-border/50"
		>
			{rows.map(({ group, task }) => {
				const { project } = group;
				return (
					<li key={`${group.root} ${task.task}`}>
						<TaskRow
							task={task}
							project={group.here ? null : group.name}
							needing={group.needing}
							onOpen={() =>
								group.here || project === null
									? onOpen(task.task)
									: navigation.show(taskUrl(project, task.task))
							}
						/>
					</li>
				);
			})}
		</ul>
	);
}

/** Project `project`'s page, opened on its task `task`. */
function taskUrl(project: string, task: string): string {
	const url = new URL(location.href);
	url.searchParams.set("project", project);
	url.hash = `#tasks/${task}`;
	return url.toString();
}

/** This project's tasks at work, a row each, while the other projects' are not to be had. */
function TaskRows({
	rows,
	onOpen,
}: {
	rows: Details[];
	onOpen: (task: string) => void;
}): JSX.Element {
	if (rows.length === 0) {
		return <QueueEmpty>No tasks at work</QueueEmpty>;
	}
	return (
		<ul
			aria-label="task list"
			className="flex flex-col divide-y divide-border/50"
		>
			{rows.map((task) => (
				<li key={task.task}>
					<TaskRow
						task={task}
						project={null}
						needing={null}
						onOpen={() => onOpen(task.task)}
					/>
				</li>
			))}
		</ul>
	);
}

/**
 * A task at work: its name with the marks of the conversations on it, a
 * coming conflict, its project when another's, how long it has been at work,
 * and Open, which opens where it stands in splates.
 */
function TaskRow({
	task,
	project,
	needing,
	onOpen,
}: {
	task: Details;
	/** Its project's name, for another project's; null for this one's. */
	project: string | null;
	/**
	 * What the conversations on another project's tasks need, which this
	 * page's `Dispatching` does not hold; null for this project's own.
	 */
	needing: Needing[] | null;
	onOpen: () => void;
}): JSX.Element {
	return (
		<QueueRow
			name={task.task}
			marks={
				<>
					{task.comingConflict && task.comingConflict.length > 0 && (
						<Badge
							variant="destructive"
							title={`Committed tips conflict in: ${task.comingConflict.join(", ")}`}
						>
							Coming conflict
						</Badge>
					)}
					{needing === null ? (
						<>
							<OrphanedMark task={task.task} />
							<OnIt task={task.task} variant="marks" />
						</>
					) : (
						<ElsewhereMarks rows={needing} task={task.task} />
					)}
				</>
			}
			by={project ?? undefined}
			age={
				task.createdAt !== null || task.age !== null ? (
					<span title="Elapsed time since this task started, including waits">
						<span className="sr-only">Elapsed: </span>
						{task.createdAt === null ? task.age : age(task.createdAt)}
					</span>
				) : undefined
			}
			main={{ label: "Open", onClick: onOpen }}
		/>
	);
}

/** A mark on a row of this project's `task` when no agent is left on it. */
function OrphanedMark({ task }: { task: string }): JSX.Element | null {
	const context = useContext(Dispatching);
	return context?.dispatch.orphaned(task) ? <Orphaned /> : null;
}

/** The marks `OnIt` draws, for the conversations on another project's `task`. */
function ElsewhereMarks({
	rows,
	task,
}: {
	rows: Needing[];
	task: string;
}): JSX.Element | null {
	const on = rows.filter(({ conversation }) => conversation?.task === task);
	if (on.length === 0) {
		return null;
	}
	return (
		<span className="flex flex-wrap items-center gap-x-1 gap-y-0.5">
			{on.map(({ conversation, need }) =>
				conversation === null ? null : (
					<span key={conversation.id} className="inline-flex items-center">
						{conversation.queue === null ? (
							<Mark need={need} reported={reportedAs(conversation)} />
						) : (
							<QueueMark spot={conversation.queue} />
						)}
					</span>
				),
			)}
		</span>
	);
}

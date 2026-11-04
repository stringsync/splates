import { age } from "@splates/server/age";
import { named, type TaskRecord } from "@splates/server/board/browser";
import type { ConversationState } from "@splates/server/conversations";
import { type Needing, needs } from "@splates/server/plans/browser";
import type { Details, Snapshot } from "@splates/server/tasks";
import { useDisposerEffect, useReactive } from "core/react";
import { Duration } from "core/time";
import { type JSX, useContext, useRef } from "react";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { Board as BoardContextOf, NO_BOARD } from "./board";
import { Badge } from "./components/ui/badge";
import { reportedAs } from "./conversation-names";
import { Dispatching, OnIt } from "./dispatching";
import { useEverywhere } from "./everywhere-context";
import type { EverywhereSummary, InProject } from "./everywhere-feed";
import { FinishedReferences } from "./finished-references";
import { FinishedByName, FinishedTasks } from "./finished-tasks";
import { fadeOf, useEdges } from "./hooks/use-edges";
import { useNow } from "./hooks/use-now";
import { LaneChip } from "./lane-chip";
import { Orphaned } from "./list-rows";
import { useMachine } from "./machine";
import { Mark } from "./mark";
import { NavigationContext } from "./navigation";
import { useReading } from "./page-readings";
import { PermanentLock, QUEUE_BOARD_WHY, QueueColumn } from "./queue-column";
import { QueueControls } from "./queue-controls";
import { QueueEmpty, QueueRow } from "./queue-rows";
import { Running, useKnown, Waiting } from "./queue-running";
import { useRefusals } from "./refusal";
import { RouteTrail } from "./route-trail";
import { QueueMark } from "./start-queue";
import { Task } from "./task-dialog";
import {
	type Filtered,
	projectOptions,
	type TaskFilter,
	tagOptions,
} from "./task-filter";
import { TaskFilterBar } from "./task-filter-menu";
import { BlockedColumn, QueuedColumn } from "./task-queue";
import { TopBar } from "./top-bar";
import { WorkerPoolView } from "./worker-pool";

/**
 * The Queue page, a board of all the work: what runs in every project, what
 * is queued in start order, what is stuck, and what finished today. Pause sits
 * in its bar. A task opens where it stands, another project's on that
 * project's page.
 */
export function Tasks({
	project,
	open,
	onOpen,
	onOpenTodo,
	onOpenLane,
	onBoards,
	filter,
}: {
	/** The projects and tags the page is narrowed to, shared with the board. */
	filter: TaskFilter;
	/** This project, as its snapshot has it, to find among every project the feed lists. */
	project: Here;
	/** The task whose dialog is open, by name, so it follows the task as the page reads it again. */
	open: string | null;
	onOpen: (task: string | null) => void;
	/** Opens queued task `id` on the board. */
	onOpenTodo: (id: number) => void;
	/** Opens lane `id` on its board. */
	onOpenLane: (id: number) => void;
	/** Opens the list of boards. */
	onBoards?: () => void;
}): JSX.Element {
	useReactive(filter, ({ projects, tags }) => ({ projects, tags }), [
		"changed",
	]);
	const everyTask = project.tasks;
	const tasks = everyTask.filter((task) => filter.passes(task));
	const saved = useContext(FinishedReferences).some(
		(task) => task.task === open,
	);
	const opened = everyTask.find((task) => task.task === open) ?? null;
	const view = useReading("workers", () => new WorkerPoolView());
	useDisposerEffect((disposer) => disposer.use(view.watch()), [view]);
	const { pool } = useReactive(view, ({ pool }) => ({ pool }), ["changed"]);
	const machine = useMachine();
	const known = useKnown(project.root);
	const held = pool?.held ?? [];
	const queue = machine?.queue ?? [];
	// A task whose agent splates started shows under Started by splates, not again below.
	const slotted = new Set(
		held.flatMap((each) =>
			each.automatic && each.task !== null
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
	const scroller = useRef<HTMLDivElement>(null);
	const { edges, read: readEdges } = useEdges(scroller);

	const { refusals: refusedTodos, refuse: refuseTodo } = useRefusals<number>();
	const lanes = named(project.todos, project.lanes);
	const board = {
		...NO_BOARD,
		linked: true,
		todos: project.todos,
		lanes,
		boards: project.boards,
		elsewhere: project.elsewhere,
		open: onOpenTodo,
		openTask: (name: string) => onOpen(name),
		openLane: onOpenLane,
		tasks: everyTask.map((each) => each.task),
		taskTags: new Map(everyTask.map((each) => [each.task, each.tags])),
		refusedTodos,
		refuseTodo,
	};
	const shown = (todo: TaskRecord) => filter.passes(todoFiltered(todo));
	const running = yours + held.filter((each) => each.automatic).length;
	return (
		<BoardContextOf value={board}>
			<section
				aria-label="queue"
				className="flex min-h-0 min-w-0 flex-1 flex-col"
			>
				<TopBar
					title={
						<div className="flex min-w-0 items-center gap-3">
							{/* A phone has Queue in its menu, and no room for the way back. */}
							<div className="shrink-0 max-md:[&_li:first-child]:hidden max-md:[&_svg]:hidden">
								<RouteTrail
									items={[
										{ label: "Boards", onClick: onBoards },
										{ label: "Queue" },
									]}
								/>
							</div>
							<PermanentLock why={QUEUE_BOARD_WHY} />
							{pool !== null && (
								<QueueControls
									view={view}
									pool={pool}
									waiting={queue.length}
									busy={
										queue.filter((each) => each.reason === "machine busy")
											.length
									}
								/>
							)}
						</div>
					}
				/>
				<div className="mb-2">
					<TaskFilterBar
						filter={filter}
						projects={projectOptions(
							[...project.todos.map(todoFiltered), ...everyTask],
							filter.projects,
						)}
						tags={tagOptions(
							project.allowedTags,
							[...project.todos.map(todoFiltered), ...everyTask],
							filter.tags,
						)}
					/>
				</div>
				<div
					ref={scroller}
					onScroll={readEdges}
					style={{ maskImage: fadeOf(edges) }}
					className="relative -mx-4 -mt-1 flex min-h-0 flex-1 snap-x scroll-px-4 items-start gap-3 overflow-x-auto px-4 pt-1 pb-4 max-md:snap-mandatory"
				>
					<BlockedColumn shown={shown} staleness={project.taskStalenessMs} />
					<QueuedColumn shown={shown} staleness={project.taskStalenessMs} />
					<QueueColumn
						title="Running"
						why="Permanent column: tasks an agent is working on. A card arrives when an agent starts it, and leaves when the task ends."
						count={running}
					>
						<Running held={held} known={known} />
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
						{running === 0 && <QueueEmpty>Nothing running</QueueEmpty>}
						<Waiting queue={queue} known={known} />
					</QueueColumn>
					<FinishedTasks moved={tasks.map((task) => task.task).join("\n")} />
				</div>
				<Dialog
					open={opened !== null || saved}
					onOpenChange={(opening) => {
						if (!opening) {
							onOpen(null);
						}
					}}
				>
					{opened ? (
						<Task task={opened} />
					) : (
						open !== null && <FinishedByName name={open} />
					)}
				</Dialog>
			</section>
		</BoardContextOf>
	);
}

/** What the Tasks page reads of this project's snapshot. */
type Here = Pick<
	Snapshot,
	| "tasks"
	| "todos"
	| "lanes"
	| "boards"
	| "elsewhere"
	| "root"
	| "repo"
	| "allowedTags"
	| "taskStalenessMs"
>;

/** What the filter reads of a queued task. */
function todoFiltered(todo: TaskRecord): Filtered {
	return { project: todo.scope ?? null, tags: todo.labels ?? [] };
}

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
}): JSX.Element | null {
	const navigation = useContext(NavigationContext);
	const rows = groups.flatMap((group) =>
		group.tasks.map((task) => ({ group, task })),
	);
	if (rows.length === 0) {
		return null;
	}
	return (
		<ul aria-label="task list" className="flex flex-col gap-1.5">
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
}): JSX.Element | null {
	if (rows.length === 0) {
		return null;
	}
	return (
		<ul aria-label="task list" className="flex flex-col gap-1.5">
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
	const { todos } = useContext(BoardContextOf);
	const taken =
		project === null
			? todos.find((todo) => todo.takenBy === task.task)
			: undefined;
	return (
		<QueueRow
			name={task.task}
			tags={task.tags}
			by={project ?? (taken && <LaneChip lane={taken.lane} />)}
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

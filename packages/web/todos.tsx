import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import {
	type LaneState,
	lanes as laneList,
	named,
	type TaskRecord,
} from "@splates/server/board/browser";
import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { AddLane } from "./add-lane";
import { Board as BoardContext, takenTask } from "./board";
import { BoardDrag } from "./board-drag";
import { saveBoard, useSavedBoard } from "./board-places";
import { BoardSwitcher } from "./board-switcher";
import type { Drafts } from "./drafts";
import { FinishedByName } from "./finished-tasks";
import { fadeOf, useEdges } from "./hooks/use-edges";
import { columnId, Lane } from "./lanes";
import { useRefusals } from "./refusal";
import { RouteTrail } from "./route-trail";
import { shownLanes } from "./shown-lanes";
import { Task } from "./task-dialog";
import { type Filtered, projectOptions, tagOptions } from "./task-filter";
import { TaskFilterBar } from "./task-filter-menu";
import { TodoBoard } from "./todo-board";
import { TodoDialog } from "./todo-dialog";
import type { TodoView } from "./todo-view";
import { TopBar } from "./top-bar";

/**
 * Renders the board page for `snapshot`: its todos in the
 * lanes, which the person orders by dragging cards and lanes.
 */
export function Todos({
	snapshot,
	drafts,
	view,
	lane = null,
	onLane,
	onIndex,
}: {
	snapshot: Snapshot;
	drafts: Drafts;
	/** The page's, so ⌘K can open a todo. */
	view: TodoView;
	/** The lane the board was opened on, shown and scrolled to, or null. */
	lane?: number | null;
	/** Opens the board on a lane, as a chip naming one asks. */
	onLane: (id: number) => void;
	onIndex?: () => void;
}): JSX.Element {
	const [board] = useState(() => new TodoBoard());
	// Every choice is read, so any of them changing renders again; `show` then
	// applies them to whichever snapshot came last.
	const { hidden, only, openedTask } = useReactive(
		view,
		({ opened, openedTask, hidden, only }) => ({
			opened,
			openedTask,
			hidden,
			only,
		}),
		["changed"],
	);
	const { dragging, naming, draggingLane } = useReactive(
		board,
		({ dragging, dropped, naming, draggingLane, droppedLanes }) => ({
			dragging,
			dropped,
			naming,
			draggingLane,
			droppedLanes,
		}),
		["changed"],
	);
	const filter = view.taskFilter;
	useReactive(filter, ({ projects, tags }) => ({ projects, tags }), [
		"changed",
	]);
	const { current, task } = view.show(snapshot);
	// What was dropped and is pending, until the server's word on it arrives.
	const moving = board.moving(snapshot.todos);
	const movingLane = board.movingLane(snapshot.lanes);
	// The board as dropped, until the server's word on it arrives.
	const { todos: all, lifted } = board.show(snapshot.todos);
	// The lanes as dropped, too, until the server's word on them arrives.
	const shownLanes = board.showLanes(snapshot.lanes);
	const records = useMemo(() => named(all, shownLanes), [all, shownLanes]);
	// Blockers and the lanes' next todos are read from every todo; only what
	// each column lists is narrowed.
	const passes = (todo: TaskRecord) =>
		(only === null || only.includes(todo.id)) && filter.passes(filtered(todo));
	// The board the person picked, else the one the URL or this device had,
	// else the project's first; a lane with no board, from an older server,
	// is on the first.
	const picked = useSavedBoard();
	useEffect(() => {
		if (
			picked !== null &&
			snapshot.boards?.some((each) => each.id === picked && !each.archived)
		) {
			saveBoard(picked);
		}
	}, [picked, snapshot.boards]);
	const liveBoards = snapshot.boards?.filter((each) => !each.archived) ?? [];
	// Something opened that sits on another board brings its board up: a lane
	// the board was opened on, a task from a link or search, a note's card.
	const boardOf = (laneId: number | null | undefined) =>
		laneId == null
			? undefined
			: (snapshot.lanes.find((each) => each.id === laneId)?.board ??
				snapshot.boards?.[0]?.id);
	const opening =
		boardOf(lane) ??
		boardOf(current?.lane) ??
		(openedTask === null
			? undefined
			: boardOf(all.find((todo) => todo.takenBy === openedTask)?.lane));
	// Resolve a linked board before drawing its title or lanes, rather than
	// showing the remembered board until the selection effect runs.
	const boardId =
		liveBoards.find((each) => each.id === (opening ?? picked))?.id ??
		liveBoards[0]?.id ??
		snapshot.boards?.[0]?.id ??
		null;

	const brought = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (opening === undefined) {
			brought.current = undefined;
			return;
		}
		if (opening === brought.current) {
			return;
		}
		brought.current = opening;
		if (liveBoards.some((each) => each.id === opening)) {
			saveBoard(opening);
		}
	}, [opening, liveBoards]);
	useEffect(() => {
		if (
			liveBoards.length > 0 &&
			!liveBoards.some((each) => each.id === (opening ?? picked))
		) {
			onIndex?.();
		}
	}, [opening, liveBoards, picked, onIndex]);
	const lanes = laneList(all, records)
		.filter(
			(lane) =>
				boardId === null || lane.board === undefined || lane.board === boardId,
		)
		.map((lane) => ({
			...lane,
			todos: lane.todos.filter(passes),
		}));
	const kept = all.filter(passes);
	const shown = lanes.filter((lane) => !hidden.includes(lane.id));
	const switcher =
		snapshot.boards !== undefined && boardId !== null ? (
			<BoardSwitcher
				boards={snapshot.boards}
				current={boardId}
				mode="current"
				onBrowse={onIndex}
				tasks={snapshot.boards.map((each) => {
					const own = laneList(all, records).filter(
						(lane) => (lane.board ?? snapshot.boards?.[0]?.id) === each.id,
					);
					return {
						id: each.id,
						lanes: own.map((lane) => lane.id),
						tasks: own.flatMap((lane) => lane.todos),
					};
				})}
				onPick={saveBoard}
			/>
		) : undefined;
	const { refusals: refusedTodos, refuse: refuseTodo } = useRefusals<number>();
	const { refusals: refusedLanes, refuse: refuseLane } = useRefusals<
		number | null
	>();
	const context = useMemo(
		() => ({
			linked: true,
			todos: all,
			lanes: records,
			boards: snapshot.boards,
			elsewhere: snapshot.elsewhere,
			open: (id: number) => {
				const task = takenTask(all, snapshot.tasks, id);
				if (task === null) {
					view.open(id);
				} else {
					view.openTask(task);
				}
			},
			openTask: (name: string) => view.openTask(name),
			openTodos: (ids: readonly number[]) => view.filter(ids),
			openLane: onLane,
			tasks: snapshot.tasks.map((each) => each.task),
			taskTags: new Map(snapshot.tasks.map((each) => [each.task, each.tags])),
			moveLane: (id: number, position: number) =>
				void board
					.moveLane(snapshot.lanes, id, position)
					?.catch((error: unknown) => refuseLane(id, "Not moved", error)),
			refusedTodos,
			refuseTodo,
			refusedLanes,
			refuseLane,
			drafts,
			moving,
			movingLane,
		}),
		[
			moving,
			movingLane,
			drafts,
			all,
			records,
			view,
			onLane,
			board,
			snapshot,
			refusedTodos,
			refuseTodo,
			refusedLanes,
			refuseLane,
		],
	);
	const scroller = useRef<HTMLDivElement>(null);
	const { edges, read: readEdges } = useEdges(scroller);
	// Room for one column at a time, as on a phone, the board opens on the
	// first lane.
	const opened = useRef(false);
	// Switching boards opens the new one on its first lane too.
	const openedBoard = useRef(boardId);
	useEffect(() => {
		const board = scroller.current;
		if (openedBoard.current !== boardId) {
			openedBoard.current = boardId;
			opened.current = false;
			if (board !== null) {
				board.scrollLeft = 0;
			}
		}
		if (opened.current || board === null || shown.length === 0) {
			return;
		}
		opened.current = true;
		const first = board.querySelector<HTMLElement>(
			`section[aria-label="${CSS.escape(shown[0]?.name ?? "")}"]`,
		);
		if (first !== null && board.clientWidth < 2 * first.offsetWidth) {
			// Clear of the board's padding, as its snapping leaves a column.
			board.scrollLeft +=
				first.getBoundingClientRect().left -
				board.getBoundingClientRect().left -
				Number.parseFloat(getComputedStyle(board).scrollPaddingLeft || "0");
		}
	}, [shown, boardId]);
	// Opened on a lane: shown if hidden, then scrolled to, once each time.
	const revealed = useRef<number | null>(null);
	useEffect(() => {
		if (lane === null) {
			revealed.current = null;
			return;
		}
		if (revealed.current === lane) {
			return;
		}
		if (hidden.includes(lane)) {
			view.hide(hidden.filter((each) => each !== lane));
			return;
		}
		const column = scroller.current?.querySelector(
			`section[data-lane="${lane}"]`,
		);
		if (column) {
			revealed.current = lane;
			column.scrollIntoView({ block: "nearest", inline: "start" });
		}
	}, [lane, hidden, view]);
	return (
		<BoardContext value={context}>
			<BoardDrag
				board={board}
				refuseTodo={refuseTodo}
				refuseLane={refuseLane}
				todos={snapshot.todos}
				lanes={snapshot.lanes}
				staleness={snapshot.taskStalenessMs}
				lifted={lifted}
				liftedLane={lanes.find((lane) => lane.id === draggingLane)}
			>
				{only !== null && (
					<p className="mb-2 flex items-center gap-2 text-muted-foreground text-xs">
						Showing {kept.length} of {all.length} tasks
						<Button
							variant="outline"
							size="xs"
							onClick={() => view.filter(null)}
						>
							Show all
						</Button>
					</p>
				)}
				<TodosBar
					lanes={lanes}
					hidden={hidden}
					view={view}
					switcher={
						<div className="flex min-w-0 items-center gap-1">
							<RouteTrail
								items={[
									{ label: "Boards", onClick: onIndex },
									{
										label:
											liveBoards.find((each) => each.id === boardId)?.name ??
											"Board",
									},
								]}
							/>
							{switcher}
						</div>
					}
				/>
				<div className="mb-2">
					<TaskFilterBar
						filter={filter}
						projects={projectOptions(all.map(filtered), filter.projects)}
						tags={tagOptions(
							snapshot.allowedTags,
							all.map(filtered),
							filter.tags,
						)}
					/>
				</div>
				<div
					ref={scroller}
					onScroll={readEdges}
					// Faded where more columns are scrolled out of view, so a column
					// cut off at the edge reads as more to see, not as the end.
					style={{ maskImage: fadeOf(edges) }}
					// On a phone, a column fills the width and a swipe stops on the
					// next one, as Trello's lists do; a drag lets go of the stops so
					// its scrolling to an edge is not snapped back.
					className={cn(
						"-mx-4 -mt-1 flex min-h-0 flex-1 snap-x scroll-px-4 items-start gap-3 overflow-x-auto px-4 pt-1 pb-4",
						dragging === null &&
							draggingLane === null &&
							"max-md:snap-mandatory",
					)}
				>
					<SortableContext
						items={shown.map((lane) => columnId(lane.id))}
						strategy={horizontalListSortingStrategy}
					>
						{shown.map((each) => (
							<Lane
								key={each.id}
								lane={each}
								lanes={lanes}
								staleness={snapshot.taskStalenessMs}
								opened={each.id === lane}
							/>
						))}
					</SortableContext>
					<AddLane
						board={boardId ?? undefined}
						empty={lanes.length === 0}
						dragging={dragging !== null}
						naming={all.find((todo) => todo.id === naming)}
						onName={(name) =>
							board.name(snapshot.todos, name) ?? Promise.resolve()
						}
						onUnname={() => board.unname()}
					/>
				</div>
			</BoardDrag>
			<TodoDialog todo={current} onClose={() => view.close()} />
			<Dialog
				open={openedTask !== null}
				onOpenChange={(open) => {
					if (!open) {
						view.closeTask();
					}
				}}
			>
				{task ? (
					<Task task={task} />
				) : (
					openedTask !== null && <FinishedByName name={openedTask} />
				)}
			</Dialog>
		</BoardContext>
	);
}

/** The board's bar: which lanes it shows. */
function TodosBar({
	lanes,
	hidden,
	view,
	switcher,
}: {
	switcher?: JSX.Element;
	lanes: LaneState[];
	hidden: number[];
	view: TodoView;
}): JSX.Element {
	return (
		<TopBar
			title={switcher ?? "Board"}
			actions={[
				shownLanes({
					lanes,
					hidden,
					onToggle: (lane) => view.toggleLane(lane),
					onHide: (lanes) => view.hide(lanes),
				}),
			]}
		/>
	);
}

/** What the filter reads of a todo. */
function filtered(todo: TaskRecord): Filtered {
	return { project: todo.scope ?? null, tags: todo.labels ?? [] };
}

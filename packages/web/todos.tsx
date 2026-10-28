import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import {
	type LaneState,
	lanes as laneList,
	named,
} from "@stringsync/splates-server/board/browser";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { cn } from "#web/lib/utils.ts";
import { AddLane } from "./add-lane";
import { Board as BoardContext, takenTask } from "./board";
import { BoardDrag } from "./board-drag";
import type { Drafts } from "./drafts";
import { fadeOf, useEdges } from "./hooks/use-edges";
import { columnId, Lane, Untriaged } from "./lanes";
import { useRefusals } from "./refusal";
import { shownLanes } from "./shown-lanes";
import { Task } from "./task-dialog";
import { TodoBoard } from "./todo-board";
import { TodoDialog } from "./todo-dialog";
import type { TodoView } from "./todo-view";
import { TopBar } from "./top-bar";

/**
 * Renders the board page for `snapshot`: its todos in Untriaged and the
 * lanes, which the person orders by dragging cards and lanes.
 */
export function Todos({
	snapshot,
	drafts,
	view,
	lane = null,
	onLane,
}: {
	snapshot: Snapshot;
	drafts: Drafts;
	/** The page's, so ⌘K can open a todo. */
	view: TodoView;
	/** The lane the board was opened on, shown and scrolled to, or null. */
	lane?: number | null;
	/** Opens the board on a lane, as a chip naming one asks. */
	onLane: (id: number) => void;
}): JSX.Element {
	const [board] = useState(() => new TodoBoard());
	// Every choice is read, so any of them changing renders again; `show` then
	// applies them to whichever snapshot came last.
	const { hidden, only } = useReactive(
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
	const lanes = laneList(all, records).map((lane) =>
		only === null
			? lane
			: { ...lane, todos: lane.todos.filter((todo) => only.includes(todo.id)) },
	);
	const kept =
		only === null ? all : all.filter((todo) => only.includes(todo.id));
	const shown = lanes.filter((lane) => !hidden.includes(lane.id));
	const { refusals: refusedTodos, refuse: refuseTodo } = useRefusals<number>();
	const { refusals: refusedLanes, refuse: refuseLane } = useRefusals<
		number | null
	>();
	const context = useMemo(
		() => ({
			linked: true,
			todos: all,
			lanes: records,
			elsewhere: snapshot.elsewhere,
			open: (id: number) => {
				const task = takenTask(all, snapshot.tasks, id);
				if (task === null) {
					view.open(id);
				} else {
					view.openTask(snapshot, task);
				}
			},
			openTask: (name: string) => view.openTask(snapshot, name),
			openTodos: (ids: readonly number[]) => view.filter(ids),
			openLane: onLane,
			tasks: snapshot.tasks.map((each) => each.task),
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
	// first lane rather than an empty Untriaged.
	const untriaged = all.some((todo) => todo.lane === null);
	const opened = useRef(false);
	useEffect(() => {
		const board = scroller.current;
		if (opened.current || board === null || shown.length === 0) {
			return;
		}
		opened.current = true;
		const first = board.querySelector<HTMLElement>(
			`section[aria-label="${CSS.escape(shown[0]?.name ?? "")}"]`,
		);
		if (
			!untriaged &&
			!hidden.includes(null) &&
			first !== null &&
			board.clientWidth < 2 * first.offsetWidth
		) {
			// Clear of the board's padding, as its snapping leaves a column.
			board.scrollLeft +=
				first.getBoundingClientRect().left -
				board.getBoundingClientRect().left -
				Number.parseFloat(getComputedStyle(board).scrollPaddingLeft || "0");
		}
	}, [shown, untriaged, hidden]);
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
					untriaged={kept.filter((todo) => todo.lane === null).length}
					hidden={hidden}
					view={view}
				/>
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
					{!hidden.includes(null) && (
						<Untriaged
							todos={kept.filter((todo) => todo.lane === null)}
							staleness={snapshot.taskStalenessMs}
						/>
					)}
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
				open={task !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						view.closeTask();
					}
				}}
			>
				{task && <Task task={task} />}
			</Dialog>
		</BoardContext>
	);
}

/** The board's bar: which lanes it shows. */
function TodosBar({
	lanes,
	untriaged,
	hidden,
	view,
}: {
	lanes: LaneState[];
	/** How many todos shown are in no lane. */
	untriaged: number;
	hidden: (number | null)[];
	view: TodoView;
}): JSX.Element {
	return (
		<TopBar
			title="Board"
			actions={[
				shownLanes({
					lanes,
					untriaged,
					hidden,
					onToggle: (lane) => view.toggleLane(lane),
					onHide: (lanes) => view.hide(lanes),
				}),
			]}
		/>
	);
}

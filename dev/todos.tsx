import {
	horizontalListSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "#dev/components/ui/dialog.tsx";
import { lanes as laneList, named } from "../lanes";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { AddLane } from "./add-lane";
import { Board as BoardContext, plansOf } from "./board";
import { BoardDrag } from "./board-drag";
import { StartLanes } from "./dispatching";
import type { Drafts } from "./drafts";
import { fadeOf, useEdges } from "./hooks/use-edges";
import { columnId, Lane, Untriaged } from "./lanes";
import { useRefusals } from "./refusal";
import { ShownLanes } from "./shown-lanes";
import { Task } from "./tasks";
import { TodoBoard } from "./todo-board";
import { Edit } from "./todo-edit";
import type { TodoView } from "./todo-view";

/**
 * Work deferred for later as a board, a Trello lite: the untriaged todos
 * first, where new ones land, then a column for each lane, a queue an
 * orchestrator works, then a way to add another. Picking one up takes an agent (`arbor
 * add <task> --todo <id>`), and `merge` recommends the highest open one, so
 * the order is the priority: drag a card up or down, or into a lane, or tap
 * one to reword, link, place or remove it. A lane moves by its header, as a
 * Trello list does.
 */
export function Todos({
	snapshot,
	drafts,
	view,
}: {
	snapshot: Snapshot;
	drafts: Drafts;
	/** The page's, so ⌘K can open a todo. */
	view: TodoView;
}): JSX.Element {
	const [board] = useState(() => new TodoBoard());
	// Every choice is read, so any of them changing renders again; `show` then
	// applies them to whichever snapshot came last.
	const { hidden } = useReactive(
		view,
		({ opened, openedTask, hidden }) => ({ opened, openedTask, hidden }),
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
	// The board as dropped, until the server's word on it arrives.
	const { todos: all, lifted } = board.show(snapshot.todos);
	// The lanes as dropped, too, until the server's word on them arrives.
	const shownLanes = board.showLanes(snapshot.lanes);
	const records = useMemo(() => named(all, shownLanes), [all, shownLanes]);
	const lanes = laneList(all, records);
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
			open: (id: number) => view.open(id),
			openTask: (name: string) => view.openTask(snapshot, name),
			tasks: snapshot.tasks.map((each) => each.task),
			plans: plansOf(snapshot.tasks),
			moveLane: (id: number, position: number) =>
				void board
					.moveLane(snapshot.lanes, id, position)
					?.catch((error: unknown) => refuseLane(id, "Not moved", error)),
			refusedTodos,
			refusedLanes,
			refuseLane,
			drafts,
		}),
		[
			drafts,
			all,
			records,
			view,
			board,
			snapshot,
			refusedTodos,
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
	return (
		<BoardContext value={context}>
			<BoardDrag
				board={board}
				refuseTodo={refuseTodo}
				refuseLane={refuseLane}
				todos={snapshot.todos}
				lanes={snapshot.lanes}
				staleness={snapshot.todoStalenessMs}
				lifted={lifted}
				liftedLane={lanes.find((lane) => lane.id === draggingLane)}
			>
				<div className="mb-2 flex gap-2">
					<ShownLanes
						lanes={lanes}
						untriaged={all.filter((todo) => todo.lane === null).length}
						hidden={hidden}
						onToggle={(lane) => view.toggleLane(lane)}
						onHide={(lanes) => view.hide(lanes)}
					/>
					<StartLanes
						lanes={lanes}
						untriaged={all.some(
							(todo) => todo.lane === null && todo.takenBy === null,
						)}
					/>
				</div>
				<div
					ref={scroller}
					onScroll={readEdges}
					// Faded where more columns are scrolled out of view, so a column
					// cut off at the edge reads as more to see, not as the end.
					style={{ maskImage: fadeOf(edges) }}
					className="-mx-4 flex snap-x scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4"
				>
					{!hidden.includes(null) && (
						<Untriaged
							todos={all.filter((todo) => todo.lane === null)}
							staleness={snapshot.todoStalenessMs}
						/>
					)}
					<SortableContext
						items={shown.map((lane) => columnId(lane.id))}
						strategy={horizontalListSortingStrategy}
					>
						{shown.map((lane) => (
							<Lane
								key={lane.id}
								lane={lane}
								lanes={lanes}
								staleness={snapshot.todoStalenessMs}
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

/**
 * `todo` open in its dialog, to change it, link it or drop it, from the board
 * or from wherever it is mentioned; closed while there is none.
 */
export function TodoDialog({
	todo,
	onClose,
}: {
	todo: TodoState | undefined;
	onClose: () => void;
}): JSX.Element {
	const popup = useRef<HTMLDivElement>(null);
	return (
		<Dialog
			open={todo !== undefined}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			{todo && (
				// Held here rather than in Edit, so opening another todo from a
				// mention swaps what the dialog shows without opening it again.
				<DialogContent
					ref={popup}
					// The dialog itself, not its subject: a phone keeps its
					// keyboard down until a field is tapped.
					initialFocus={popup}
					className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl"
				>
					{/* Keyed, so another todo starts on its own words. */}
					<Edit key={todo.id} todo={todo} onDone={onClose} />
				</DialogContent>
			)}
		</Dialog>
	);
}

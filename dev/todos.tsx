// scry-ignore-file compact-files: split by a todo in arbor lanes 11 to 19, which removes this line
import {
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	MouseSensor,
	pointerWithin,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	horizontalListSortingStrategy,
	SortableContext,
	sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useReactive } from "@webappwiz/react";
import { Trash2Icon } from "lucide-react";
import {
	type JSX,
	type ReactNode,
	type RefObject,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupTextarea,
} from "#dev/components/ui/input-group.tsx";
import {
	type LaneRecord,
	type LaneState,
	lanes as laneList,
	named,
} from "../lanes";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { assignTodo } from "./api";
import { Board as BoardContext } from "./board";
import { Card, CopyLink } from "./card";
import { AssigneeMenu, OnIt, StartLanes, StartMenu } from "./dispatching";
import { type Drafts, todoEdit } from "./drafts";
import { AttachButton, Dropped, FileList } from "./files";
import {
	AddLane,
	columnId,
	columnOf,
	Lane,
	LiftedLane,
	laneOf,
	ShownLanes,
	Untriaged,
} from "./lanes";
import { Links } from "./links";
import { Markdown } from "./markdown";
import { MentionAnchor, useMentions } from "./mentions";
import { Refusal, useRefusal, useRefusals } from "./refusal";
import { Task } from "./tasks";
import { TodoBoard } from "./todo-board";
import { TodoEditor } from "./todo-editor";
import type { TodoView } from "./todo-view";

/**
 * Work deferred for later as a board, a Trello lite: the untriaged todos
 * first, where new ones land, then a column for each lane, one agent's
 * queue, then a way to add another. Picking one up takes an agent (`arbor
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
	const { refusals: refusedLanes, refuse: refuseLane } = useRefusals<number>();
	const context = useMemo(
		() => ({
			linked: true,
			todos: all,
			lanes: records,
			open: (id: number) => view.open(id),
			openTask: (name: string) => view.openTask(snapshot, name),
			tasks: snapshot.tasks.map((each) => each.task),
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
			<Drag
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
					<StartLanes lanes={lanes} />
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
			</Drag>
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

/** Whether there is more of `board` to scroll to on its left and its right. */
interface Edges {
	left: boolean;
	right: boolean;
}

function edgesOf(board: HTMLElement | null): Edges {
	if (board === null) {
		return { left: false, right: false };
	}
	return {
		left: board.scrollLeft > 1,
		right: board.scrollLeft + board.clientWidth < board.scrollWidth - 1,
	};
}

/**
 * `board`'s edges, read again as it resizes or its columns change, and by
 * `read`, which its scrolling calls.
 */
function useEdges(board: RefObject<HTMLElement | null>): {
	edges: Edges;
	read: () => void;
} {
	const [edges, setEdges] = useState<Edges>({ left: false, right: false });
	const read = useCallback(() => {
		const next = edgesOf(board.current);
		setEdges((was) =>
			was.left === next.left && was.right === next.right ? was : next,
		);
	}, [board]);
	useEffect(() => {
		const element = board.current;
		if (element === null) {
			return;
		}
		const observer = new ResizeObserver(read);
		observer.observe(element);
		for (const column of element.children) {
			observer.observe(column);
		}
		read();
		return () => observer.disconnect();
	});
	return { edges, read };
}

/** A mask fading out each edge with more beyond it. */
function fadeOf({ left, right }: Edges): string | undefined {
	if (!left && !right) {
		return undefined;
	}
	return `linear-gradient(to right, ${left ? "transparent, black 2.5rem" : "black"}, ${right ? "black calc(100% - 2.5rem), transparent" : "black"})`;
}

/**
 * Lets a card be dragged anywhere on the board: up or down its column, onto
 * a card in a lane to join it there, onto a column's space for its bottom,
 * or onto the new lane column; and a lane, by its header, left or right
 * past the others. A mouse drags once it moves a few pixels and a finger
 * after a short press, so a tap still opens the card and a swipe still
 * scrolls; a keyboard picks a card up by its grip with Space and moves it
 * with the arrows.
 */
function Drag({
	board,
	refuseTodo,
	refuseLane,
	todos,
	lanes,
	staleness,
	lifted,
	liftedLane,
	children,
}: {
	board: TodoBoard;
	/** Says on a card that it was not moved. */
	refuseTodo: (id: number, title: string, error: unknown) => void;
	/** Says under a lane's header that it was not moved. */
	refuseLane: (id: number, title: string, error: unknown) => void;
	todos: TodoState[];
	lanes: LaneRecord[];
	staleness: number;
	lifted?: TodoState;
	liftedLane?: LaneState;
	children: ReactNode;
}): JSX.Element {
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const drop = ({ active, over }: DragEndEvent) => {
		const moving = laneOf(active.id);
		if (moving !== undefined) {
			board
				.dropLane(
					lanes,
					moving,
					over === null ? null : (laneOf(over.id) ?? null),
				)
				?.catch((error: unknown) => refuseLane(moving, "Not moved", error));
			return;
		}
		const lane = over === null ? undefined : columnOf(over.id);
		board
			.drop(
				todos,
				Number(active.id),
				over === null
					? null
					: lane === undefined
						? { card: Number(over.id) }
						: { lane },
			)
			?.catch((error: unknown) =>
				refuseTodo(Number(active.id), "Not moved", error),
			);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collide}
			onDragStart={({ active }) => {
				const lane = laneOf(active.id);
				if (lane === undefined) {
					board.lift(Number(active.id));
				} else {
					board.liftLane(lane);
				}
			}}
			onDragCancel={() => board.cancel()}
			onDragEnd={drop}
		>
			{children}
			{/* Lifted off the column, tilted, the way a card in hand looks: as it
			    was in its column, numbered and without its detail in a lane. */}
			<DragOverlay>
				{lifted && (
					<Card
						todo={lifted}
						staleness={staleness}
						step={
							lifted.lane === null
								? undefined
								: todos
										.filter((other) => other.lane === lifted.lane)
										.findIndex((other) => other.id === lifted.id) + 1
						}
						className="rotate-2 cursor-grabbing shadow-lg"
					/>
				)}
				{liftedLane && <LiftedLane lane={liftedLane} staleness={staleness} />}
			</DragOverlay>
		</DndContext>
	);
}

/**
 * The card under the pointer, or failing one the column, so a card dropped
 * between two lands in the column it is over; the nearest card when the
 * pointer is over neither, as when a keyboard moves it. A lane in hand
 * looks only at the other lanes, nearest first.
 */
const collide: CollisionDetection = (args) => {
	if (laneOf(args.active.id) !== undefined) {
		return closestCenter({
			...args,
			droppableContainers: args.droppableContainers.filter(
				(container) => laneOf(container.id) !== undefined,
			),
		});
	}
	const within = pointerWithin(args);
	const card = within.find((hit) => columnOf(hit.id) === undefined);
	return card ? [card] : within.length > 0 ? within : closestCenter(args);
};

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

/**
 * One todo opened: its words and files to change, where it sits on the board
 * and what it waits on, between its subject and detail, and a way to drop it.
 */
function Edit({
	todo,
	onDone,
}: {
	todo: TodoState;
	onDone: () => void;
}): JSX.Element {
	const board = useContext(BoardContext);
	const [editor] = useState(
		() =>
			new TodoEditor(
				todo,
				board.drafts,
				todoEdit(new URLSearchParams(location.search).get("project"), todo.id),
			),
	);
	const { busy, confirming, changed, restored, dropped } = useReactive(
		editor,
		(editor) => ({
			busy: editor.busy,
			confirming: editor.confirming,
			changed: editor.changed,
			restored: editor.restored,
			dropped: editor.dropped,
		}),
		["changed"],
	);
	// Its step in its lane says more than its place in the whole list. An
	// untriaged todo is in no sequence, so it says only that.
	const steps = board.todos.filter((other) => other.lane === todo.lane);
	const lane = board.lanes.find((record) => record.id === todo.lane);
	const place =
		lane === undefined
			? "Untriaged"
			: `Step ${steps.findIndex((other) => other.id === todo.id) + 1} of ${steps.length} in ${lane.name}`;
	const mentions = useMentions<HTMLInputElement>(editor.subject);

	const { refusal, refuse } = useRefusal();
	const settle = (writing: Promise<void> | null, failed: string): void => {
		writing?.then(onDone, (error: unknown) => refuse(failed, error));
	};
	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					Todo {todo.id}
					<span className="font-normal text-muted-foreground text-xs">
						<CopyLink id={todo.id} />
					</span>
				</DialogTitle>
				<DialogDescription>
					{todo.takenBy ? `Taken by ${todo.takenBy}` : place}
				</DialogDescription>
			</DialogHeader>
			<div className="flex min-w-0 flex-col gap-3">
				{restored && (
					<p className="flex items-center gap-2 text-muted-foreground text-xs">
						Unsaved changes kept from before
						<Button size="xs" variant="ghost" onClick={() => editor.discard()}>
							Discard
						</Button>
					</p>
				)}
				<MentionAnchor mentions={mentions}>
					<InputGroup>
						<InputGroupInput
							ref={mentions.ref}
							aria-label="subject"
							value={mentions.value}
							onChange={mentions.onChange}
							onSelect={mentions.onSelect}
							onClick={mentions.onClick}
							onKeyDown={mentions.onKeyDown}
							onPaste={(event) => editor.files.paste(event)}
						/>
					</InputGroup>
				</MentionAnchor>
				{todo.takenBy === null ? (
					<div className="flex flex-wrap items-center gap-2">
						<StartMenu
							assignment={{ kind: "todo", id: todo.id }}
							assignee={todo.assignee ?? lane?.assignee ?? null}
						/>
						<AssigneeMenu
							assignee={todo.assignee ?? null}
							onPick={(pick) =>
								void assignTodo(todo.id, pick).catch((error: unknown) =>
									refuse("Not assigned", error),
								)
							}
						/>
					</div>
				) : (
					<OnIt task={todo.takenBy} variant="rows" className="-mx-2" />
				)}
				<Links todo={todo} />
				<Detail editor={editor} />
				<FileList files={editor.files} />
				<Dropped names={dropped} />
				<Refusal refusal={refusal} className="text-right" />
			</div>
			<DialogFooter className="flex-row justify-between sm:justify-between">
				<Button
					variant={confirming ? "destructive" : "ghost"}
					disabled={busy}
					onClick={() => settle(editor.remove(), "Not removed")}
				>
					<Trash2Icon data-icon="inline-start" />
					{confirming ? "Remove for good" : "Remove"}
				</Button>
				<Button
					disabled={!changed || busy}
					onClick={() => settle(editor.save(), "Not saved")}
				>
					Save
				</Button>
			</DialogFooter>
		</>
	);
}

/**
 * A todo's detail, read as it renders, the way a Trello card opens; a click
 * on it, but on a link in it, writes its markdown, until focus leaves.
 */
function Detail({ editor }: { editor: TodoEditor }): JSX.Element {
	const detail = useMentions<HTMLTextAreaElement>(editor.detail);
	const [writing, setWriting] = useState(false);
	if (writing) {
		return (
			<MentionAnchor mentions={detail}>
				<InputGroup
					onBlur={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget)) {
							setWriting(false);
						}
					}}
				>
					<InputGroupTextarea
						ref={detail.ref}
						autoFocus
						aria-label="detail"
						placeholder="More to say in markdown, if any"
						value={detail.value}
						onChange={detail.onChange}
						onSelect={detail.onSelect}
						onClick={detail.onClick}
						onKeyDown={detail.onKeyDown}
						onPaste={(event) => editor.files.paste(event)}
						className="min-h-32"
					/>
					<InputGroupAddon align="block-end">
						<AttachButton files={editor.files} />
					</InputGroupAddon>
				</InputGroup>
			</MentionAnchor>
		);
	}
	if (detail.value.trim() === "") {
		return (
			<button
				type="button"
				onClick={() => setWriting(true)}
				className="flex min-h-40 items-start rounded-md border border-dashed px-3 py-2 text-left text-muted-foreground text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				Add more detail
			</button>
		);
	}
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a click anywhere on the words writes them, but a link in them still opens; its own button is what a keyboard reaches
		// biome-ignore lint/a11y/useKeyWithClickEvents: as above
		<div
			className="relative min-h-40 cursor-text rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/30"
			onClick={(event) => {
				if (!(event.target as HTMLElement).closest("a, button")) {
					setWriting(true);
				}
			}}
		>
			<Markdown text={detail.value} />
			<Button
				size="xs"
				variant="ghost"
				className="sr-only absolute top-1 right-1 focus-visible:not-sr-only"
				onClick={() => setWriting(true)}
			>
				Edit
			</Button>
		</div>
	);
}

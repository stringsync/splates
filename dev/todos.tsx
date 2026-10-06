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
	useContext,
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
import { toast } from "#dev/components/ui/toast.tsx";
import {
	type LaneRecord,
	type LaneState,
	lanes as laneList,
	named,
} from "../lanes";
import type { Snapshot } from "../snapshot";
import type { TodoState } from "../todo";
import { Board as BoardContext } from "./board";
import { Card, CopyLink } from "./card";
import { AttachButton, FileList } from "./files";
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
import { Task } from "./tasks";
import { TodoBoard } from "./todo-board";
import { TodoEditor } from "./todo-editor";
import { TodoView } from "./todo-view";

/**
 * Work deferred for later as a board, a Trello lite: the untriaged todos
 * first, where new ones land, then a column for each lane, one agent's
 * queue, then a way to add another. Picking one up takes an agent (`arbor
 * add <task> --todo <id>`), and `merge` recommends the highest open one, so
 * the order is the priority: drag a card up or down, or into a lane, or tap
 * one to reword, link, place or remove it. A lane moves by its header, as a
 * Trello list does.
 */
export function Todos({ snapshot }: { snapshot: Snapshot }): JSX.Element {
	const [view] = useState(() => new TodoView(localStorage));
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
	const context = useMemo(
		() => ({
			linked: true,
			todos: all,
			lanes: records,
			open: (id: number) => view.open(id),
			openTask: (name: string) => view.openTask(snapshot, name),
			moveLane: (id: number, position: number) =>
				void board
					.moveLane(snapshot.lanes, id, position)
					?.catch((error: unknown) => notMoved(error)),
		}),
		[all, records, view, board, snapshot],
	);
	const popup = useRef<HTMLDivElement>(null);
	return (
		<BoardContext value={context}>
			<Drag
				board={board}
				todos={snapshot.todos}
				lanes={snapshot.lanes}
				staleness={snapshot.todoStalenessMs}
				lifted={lifted}
				liftedLane={lanes.find((lane) => lane.id === draggingLane)}
			>
				<ShownLanes
					lanes={lanes}
					untriaged={all.filter((todo) => todo.lane === null).length}
					hidden={hidden}
					onToggle={(lane) => view.toggleLane(lane)}
					onHide={(lanes) => view.hide(lanes)}
				/>
				<div className="-mx-4 flex snap-x scroll-px-4 items-start gap-3 overflow-x-auto px-4 pb-4">
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
			<Dialog
				open={current !== undefined}
				onOpenChange={(open) => {
					if (!open) {
						view.close();
					}
				}}
			>
				{current && (
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
						<Edit key={current.id} todo={current} onDone={() => view.close()} />
					</DialogContent>
				)}
			</Dialog>
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

/** A toast for a move the server refused. */
function notMoved(error: unknown): void {
	toast.add({
		title: "Not moved",
		description: error instanceof Error ? error.message : String(error),
		type: "error",
	});
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
	todos,
	lanes,
	staleness,
	lifted,
	liftedLane,
	children,
}: {
	board: TodoBoard;
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
				?.catch(notMoved);
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
			?.catch(notMoved);
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
			{/* Lifted off the column, tilted, the way a card in hand looks. */}
			<DragOverlay>
				{lifted && (
					<Card
						todo={lifted}
						staleness={staleness}
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
	const [editor] = useState(() => new TodoEditor(todo));
	const { busy, confirming, changed } = useReactive(
		editor,
		(editor) => ({
			busy: editor.busy,
			confirming: editor.confirming,
			changed: editor.changed,
		}),
		["changed"],
	);
	// Its step in its column says more than its place in the whole list.
	const board = useContext(BoardContext);
	const steps = board.todos.filter((other) => other.lane === todo.lane);
	const lane = board.lanes.find((record) => record.id === todo.lane);
	const place = `Step ${steps.findIndex((other) => other.id === todo.id) + 1} of ${steps.length} in ${lane?.name ?? "Untriaged"}`;
	const mentions = useMentions<HTMLInputElement>(editor.subject);

	const settle = (writing: Promise<void> | null, failed: string): void => {
		writing?.then(onDone, (error: unknown) =>
			toast.add({
				title: failed,
				description: error instanceof Error ? error.message : String(error),
				type: "error",
			}),
		);
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
				<Links todo={todo} />
				<Detail editor={editor} />
				<FileList files={editor.files} />
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

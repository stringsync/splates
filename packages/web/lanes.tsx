import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LaneState, TaskRecord } from "@stringsync/splates-server/board";
import {
	APPROVAL,
	BACKLOG_LANE,
	BUDGET_LOW,
	elsewhereName,
} from "@stringsync/splates-server/board/browser";
import {
	HandIcon,
	ListPlusIcon,
	LockIcon,
	OctagonXIcon,
	TriangleAlertIcon,
} from "lucide-react";
import {
	type JSX,
	type MouseEventHandler,
	type TouchEventHandler,
	useContext,
	useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AddTodo } from "./add-todo";
import { approveLane, renameLane } from "./api";
import { Board, still } from "./board";
import { laneApproved, laneRenamed } from "./board-expectations";
import { Card } from "./card";
import { useExpectSnapshot } from "./expecting";
import { GroomUntriaged } from "./groom-untriaged";
import { Cards, Column, laneOfCard } from "./lane-column";
import { LaneMenu, QueueLaneButton } from "./lane-menu";
import { LaneStalled } from "./lane-stalled";
import { Refusal } from "./refusal";
import { TONES } from "./task-sections";
import { byHand } from "./todo-board";
import { StageCounts } from "./todo-queue";

/** Where a column takes a dropped card: its id among the cards' numbers. */
export function columnId(lane: number | null | "new"): string {
	return `lane:${lane ?? "none"}`;
}

/** The column a `columnId` names, or undefined for a card's number. */
export function columnOf(
	id: string | number,
): number | null | "new" | undefined {
	if (typeof id === "number" || !id.startsWith("lane:")) {
		return undefined;
	}
	const lane = id.slice("lane:".length);
	return lane === "none" ? null : lane === "new" ? "new" : Number(lane);
}

/** Where the space under lane `lane` takes a dropped card, for the tasks only the person queues. */
export function handId(lane: number): string {
	return `hand:${lane}`;
}

/** The lane whose space for tasks queued by hand a `handId` names, or undefined. */
export function handOf(id: string | number): number | undefined {
	return typeof id === "string" && id.startsWith("hand:")
		? Number(id.slice("hand:".length))
		: undefined;
}

/** The lane a `columnId` names when it is a lane's own, not the untriaged or new one. */
export function laneOf(id: string | number): number | undefined {
	const lane = columnOf(id);
	return typeof lane === "number" ? lane : undefined;
}

/**
 * The first column: every todo in no lane, where new ones land until someone
 * puts them in a lane.
 */
export function Untriaged({
	todos,
	staleness,
}: {
	/** Every untriaged todo. */
	todos: TaskRecord[];
	staleness: number;
}): JSX.Element {
	const board = useContext(Board);
	const { setNodeRef, isOver, active } = useDroppable({
		id: columnId(null),
	});
	return (
		<Column label="Untriaged" drop={setNodeRef} lit={isOver}>
			<header className="flex flex-col gap-1 px-1 pt-1">
				<div className="flex items-center justify-between gap-2">
					<h3 className="flex items-baseline gap-1.5 font-medium text-sm">
						Untriaged
						<StageCounts todos={todos} />
					</h3>
					<GroomUntriaged
						empty={!todos.some((todo) => todo.takenBy === null)}
					/>
				</div>
				<p className="text-muted-foreground text-xs">Not in a lane yet.</p>
				<Refusal refusal={board.refusedLanes.get(null)} />
			</header>
			<Cards
				todos={todos}
				label="Untriaged tasks"
				staleness={staleness}
				steps={false}
				coming={isOver && laneOfCard(board.todos, active?.id) !== null}
			/>
			{board.todos.length === 0 && (
				<p className="px-1 py-2 text-muted-foreground text-xs">
					Nothing to do yet. Agents add what comes up outside their task here.
				</p>
			)}
			<AddTodo lane={null} />
		</Column>
	);
}

/**
 * A lane on the board: a named group of tasks, top first. Its header shows
 * whether an agent is working on it and whether it is queued; a queued lane
 * that cannot go on gets an amber border. Drag the header to move the lane.
 */
export function Lane({
	lane,
	lanes,
	staleness,
	opened = false,
}: {
	lane: LaneState;
	/** Every lane, so this one can join another or move past it. */
	lanes: LaneState[];
	staleness: number;
	/** The board was opened on it, from its title in the sidebar: ringed. */
	opened?: boolean;
}): JSX.Element {
	const { refusedLanes, todos, elsewhere } = useContext(Board);
	const [renaming, setRenaming] = useState(false);
	const {
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
		isOver,
		active,
	} = useSortable({
		id: columnId(lane.id),
		// Backlog is static, right after untriaged.
		disabled: lane.id === BACKLOG_LANE,
	});
	// Lit for a card over it, not for a lane passing by.
	const lit = isOver && active !== null && laneOf(active.id) === undefined;
	// Who is on which task shows on the cards; the lane says only that one is,
	// and only while it is queued and can still go on.
	const running =
		lane.queued && lane.stalled === undefined && lane.agents.length > 0;
	// Its steps, and under it, apart and outside its glint, the tasks it
	// passes over because only the person queues them.
	const steps = lane.todos.filter((todo) => !byHand(todo));
	const hand = lane.todos.filter(byHand);
	// The lane's next task waits on one still open in another lane or project,
	// so playing the lane starts nothing until that lands.
	const next = steps.find((todo) => todo.takenBy === null);
	const local = next
		? todos.find(
				(other) =>
					next.blockedBy.includes(other.id) &&
					(next.lane === null || other.lane !== next.lane),
			)
		: undefined;
	const external = next?.blockedElsewhere?.find(
		(blocker) => blocker.landed === undefined,
	);
	const holdup =
		local !== undefined
			? { id: `#${local.id}`, subject: local.subject }
			: next !== undefined && external !== undefined
				? {
						id: elsewhereName({
							...external,
							slug: elsewhere?.blockers[next.id]?.find(
								(blocker) =>
									blocker.project === external.project &&
									blocker.id === external.id,
							)?.slug,
						}),
						subject: external.subject,
					}
				: undefined;
	const blocked = !running && holdup !== undefined;
	return (
		<div
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"flex max-h-full w-72 shrink-0 snap-start flex-col gap-1.5 max-md:w-full max-md:snap-always",
			)}
		>
			<Column
				label={lane.name}
				lane={lane.id}
				drop={setNodeRef}
				lit={lit}
				className={cn(
					// Shrinks to the wrapper's height, so a tall lane scrolls in its own
					// list rather than the board scrolling up and down with it.
					"min-h-0 w-full shrink max-md:w-full",
					// A glint running around its edge, while the lane can go on.
					running && lane.stalled === undefined && "running-outline",
					// A queued lane that cannot go on: blocked by a task elsewhere, or stalled.
					lane.queued &&
						(blocked || lane.stalled !== undefined) &&
						"border-amber-500 ring-2 ring-amber-500/60",
					opened && "ring-1 ring-primary/40",
					// The slot it leaves while it is in hand, where it will land.
					isDragging && "bg-muted ring-1 ring-border *:invisible",
				)}
			>
				{/* A mouse drags the lane from its header once it moves a few pixels
			    and a finger after a short press, so a tap still renames it; a
			    keyboard moves it from its menu. */}
				{/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer drags the lane by its header; a keyboard has Move left and right in its menu */}
				<header
					ref={setActivatorNodeRef}
					onMouseDown={listeners?.onMouseDown as MouseEventHandler}
					onTouchStart={listeners?.onTouchStart as TouchEventHandler}
					className={cn(
						"flex touch-manipulation flex-col gap-1 px-1 pt-1",
						lane.id !== BACKLOG_LANE && "cursor-grab active:cursor-grabbing",
					)}
				>
					<div className="flex items-center justify-between gap-2">
						{lane.id === BACKLOG_LANE ? (
							<h3 className="font-medium text-sm">{lane.name}</h3>
						) : renaming ? (
							<LaneName lane={lane} onDone={() => setRenaming(false)} />
						) : (
							<h3 className="flex min-w-0 items-baseline pointer-coarse:items-center font-medium text-sm">
								<button
									type="button"
									onClick={() => setRenaming(true)}
									title="Rename"
									className="-mx-1 min-w-0 pointer-coarse:min-h-10 cursor-text truncate rounded px-1 text-left outline-none hover:bg-background/70 focus-visible:ring-2 focus-visible:ring-ring"
								>
									{lane.name}
								</button>
							</h3>
						)}
						<div className="flex shrink-0 items-center">
							<QueueLaneButton lane={lane} />
							<LaneMenu
								lane={lane}
								lanes={lanes}
								onRename={() => setRenaming(true)}
							/>
						</div>
					</div>
					{/* A line of its own, so a long name keeps its room. */}
					{lane.todos.length > 0 && <StageCounts todos={lane.todos} />}
					{/* Always there, at the chips' height, so queueing or pausing the lane
				    never moves what is below; it holds one line, clipped, on a narrow screen. */}
					<span className="flex h-5 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap">
						{(running || lane.queued || blocked) && (
							<>
								{running && (
									<span
										className={cn(
											"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px font-medium text-xs",
											TONES.working,
										)}
										title="An agent is at work on one of its tasks"
									>
										<span
											aria-hidden
											className="size-1.5 rounded-full bg-primary"
										/>
										Running
									</span>
								)}
								{blocked && (
									<span
										className={cn(
											"inline-flex min-w-0 items-center gap-1 truncate rounded-md px-1.5 py-px font-medium text-xs",
											TONES.waiting,
										)}
										title={`${next?.subject} waits on ${holdup?.id} ${holdup?.subject}, so the lane will not run until it lands`}
									>
										<LockIcon aria-hidden className="size-3 shrink-0" />
										<span className="truncate">Blocked by {holdup?.id}</span>
									</span>
								)}
								{lane.queued && (
									<span
										className={cn(
											"inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-px font-medium text-xs",
											TONES.quiet,
										)}
										title="Each task is queued as soon as nothing blocks it, until the lane is empty"
									>
										<ListPlusIcon aria-hidden className="size-3" />
										Queued lane
									</span>
								)}
							</>
						)}
					</span>
					{lane.queued &&
						lane.budget !== undefined &&
						lane.budget <= BUDGET_LOW && <LaneApproval lane={lane} />}
					{lane.stalled !== undefined && (
						<LaneStalled name={lane.name} holdups={lane.stalled.holdups} />
					)}
					<Refusal refusal={refusedLanes.get(lane.id)} />
				</header>
				<Cards
					todos={steps}
					label={`${lane.name} tasks`}
					staleness={staleness}
					steps
					coming={lit && !steps.some((todo) => todo.id === active?.id)}
				/>
				<AddTodo lane={lane.id} />
			</Column>
			{!isDragging && <ByHand lane={lane} todos={hand} staleness={staleness} />}
		</div>
	);
}

/**
 * Under a lane, outside its glint: the lane's tasks only the person queues,
 * which a queued lane passes over. While a card is dragged it shows as a
 * dashed space, empty or not, to drop one on to take it out of the lane's
 * queue; dragged back up among the steps, the lane queues it again.
 */
function ByHand({
	lane,
	todos,
	staleness,
}: {
	lane: LaneState;
	todos: TaskRecord[];
	staleness: number;
}): JSX.Element | null {
	const { setNodeRef, isOver, active } = useDroppable({ id: handId(lane.id) });
	// A card in hand, not a lane passing by.
	const dragging = typeof active?.id === "number";
	if (todos.length === 0 && !dragging) {
		return null;
	}
	return (
		<section
			ref={setNodeRef}
			aria-label={`${lane.name} by hand`}
			className={cn(
				"flex min-h-0 shrink-0 flex-col gap-1 rounded-xl border border-transparent px-[calc(--spacing(2)-1px)] pt-1.5 pb-2 transition-colors",
				dragging && "border-foreground/20 border-dashed",
				isOver && "border-primary/50 bg-primary/5",
			)}
		>
			<h4
				className="flex items-center gap-1.5 px-1 font-medium text-muted-foreground text-xs"
				title="A queued lane passes over these: only Queue starts them"
			>
				<HandIcon aria-hidden className="size-3" />
				By hand
				{todos.length > 0 && (
					<span className="font-normal">{todos.length}</span>
				)}
			</h4>
			{todos.length === 0 ? (
				<p className="px-1 py-1 text-muted-foreground text-xs">
					Drop a task here for the lane to pass over it.
				</p>
			) : (
				<Cards
					todos={todos}
					label={`${lane.name} tasks by hand`}
					staleness={staleness}
					steps={false}
					coming={isOver && !todos.some((todo) => todo.id === active?.id)}
				/>
			)}
		</section>
	);
}

/**
 * What a queued lane has left of the tasks it may queue on its own, once
 * that is low, with a button that adds an approval to it; at none the lane
 * has stopped, which it says plainly, and an approval lets it go on.
 */
function LaneApproval({ lane }: { lane: LaneState }): JSX.Element {
	const { refuseLane } = useContext(Board);
	const expect = useExpectSnapshot();
	const left = lane.budget ?? 0;
	const stopped = left === 0;
	return (
		<div
			className={cn(
				"flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-sm",
				stopped
					? "border-red-500 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
					: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
			)}
			title="The lane's budget of tasks to queue on its own: at none nothing more in it starts until you approve more"
		>
			<span className="inline-flex items-center gap-1.5">
				{stopped ? (
					<OctagonXIcon aria-hidden className="size-4 shrink-0" />
				) : (
					<TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
				)}
				{stopped ? (
					<b>Budget ran out: lane stopped</b>
				) : (
					<span>
						<b>{left}</b> left to queue
					</span>
				)}
			</span>
			<Button
				size="sm"
				variant={stopped ? "destructive" : "default"}
				onClick={() =>
					void expect(
						laneApproved(lane.id, APPROVAL),
						approveLane(lane.id, APPROVAL),
					).catch((error: unknown) =>
						refuseLane(lane.id, "Not approved", error),
					)
				}
				{...still}
			>
				Approve {APPROVAL} more
			</Button>
		</div>
	);
}

/** The lane's name as a field, saved on Enter or on leaving it. */
function LaneName({
	lane,
	onDone,
}: {
	lane: LaneState;
	onDone: () => void;
}): JSX.Element {
	const { refuseLane } = useContext(Board);
	const expect = useExpectSnapshot();
	const [name, setName] = useState(lane.name);
	const save = () => {
		if (name.trim() === "" || name.trim() === lane.name) {
			onDone();
			return;
		}
		// Shown under its new name at once, so the field can go.
		onDone();
		void expect(
			laneRenamed(lane.id, name.trim()),
			renameLane(lane.id, name),
		).catch((error: unknown) => refuseLane(lane.id, "Not renamed", error));
	};
	return (
		<input
			// biome-ignore lint/a11y/noAutofocus: it opens because the name was just clicked, to type a new one
			autoFocus
			aria-label="lane name"
			value={name}
			onChange={(event) => setName(event.target.value)}
			onFocus={(event) => event.target.select()}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					save();
				} else if (event.key === "Escape") {
					onDone();
				}
			}}
			className="h-7 pointer-coarse:h-10 min-w-0 flex-1 rounded-md border bg-background px-2 font-semibold text-sm pointer-coarse:text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/**
 * A lane in hand, lifted off the board and tilted the way Trello lifts a
 * list: its name and its cards, to see what is moving.
 */
export function LiftedLane({
	lane,
	staleness,
}: {
	lane: LaneState;
	staleness: number;
}): JSX.Element {
	return (
		<section
			aria-hidden
			className="flex max-h-[calc(100dvh-6rem)] w-72 rotate-2 cursor-grabbing flex-col gap-1.5 overflow-hidden rounded-xl bg-muted p-2 shadow-lg"
		>
			<h3 className="flex items-baseline gap-1.5 px-1 pt-1 font-medium text-sm">
				{lane.name}
			</h3>
			{lane.todos.length > 0 && (
				<StageCounts todos={lane.todos} className="px-1" />
			)}
			<ol className="flex flex-col gap-1.5">
				{lane.todos
					.filter((todo) => !byHand(todo))
					.map((todo, i) => (
						<li key={todo.id}>
							<Card todo={todo} staleness={staleness} step={i + 1} />
						</li>
					))}
			</ol>
		</section>
	);
}

import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckIcon, CopyIcon } from "lucide-react";
import {
	type JSX,
	type MouseEventHandler,
	type TouchEventHandler,
	useContext,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { LaneState } from "../lanes";
import { laneReference } from "../prompts";
import type { TodoState } from "../todo";
import { AddTodo } from "./add-todo";
import { renameLane } from "./api";
import { Board, still } from "./board";
import { Card, copiedLabel, useCopy } from "./card";
import { Dispatching, OnIt } from "./dispatching";
import { Cards, Column, laneOfCard } from "./lane-column";
import { LaneMenu } from "./lane-menu";
import { Refusal } from "./refusal";
import { StartMenu } from "./start-menu";
import { TaskIcon } from "./task-icon";

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
	todos: TodoState[];
	staleness: number;
}): JSX.Element {
	const board = useContext(Board);
	const open = todos.some((todo) => todo.takenBy === null);
	const { setNodeRef, isOver, active } = useDroppable({
		id: columnId(null),
	});
	return (
		<Column label="Untriaged" drop={setNodeRef} lit={isOver}>
			<header className="flex flex-col gap-1 px-1 pt-1">
				<h3 className="flex items-baseline gap-1.5 font-medium text-sm">
					Untriaged
					<span className="font-normal text-muted-foreground text-xs tabular-nums">
						{todos.length}
					</span>
				</h3>
				<p className="text-muted-foreground text-xs">Not in a lane yet.</p>
				{open && <StartLane id={null} />}
				<Refusal refusal={board.refusedLanes.get(null)} />
			</header>
			<Cards
				todos={todos}
				label="Untriaged todos"
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
 * One lane: an agent's queue, top first. The header says who is on it, or
 * offers the prompt that starts one, and moves the lane: dragged by it, the
 * lane takes the place of the one it is let go on, as a Trello list does.
 */
export function Lane({
	lane,
	lanes,
	staleness,
}: {
	lane: LaneState;
	/** Every lane, so this one can join another or move past it. */
	lanes: LaneState[];
	staleness: number;
}): JSX.Element {
	const { openTask, refusedLanes, todos } = useContext(Board);
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
	} = useSortable({ id: columnId(lane.id) });
	// Lit for a card over it, not for a lane passing by.
	const lit = isOver && active !== null && laneOf(active.id) === undefined;
	return (
		<Column
			label={lane.name}
			drop={setNodeRef}
			lit={lit}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			// The slot it leaves while it is in hand, where it will land.
			className={cn(isDragging && "bg-muted ring-1 ring-border *:invisible")}
		>
			{/* A mouse drags the lane from its header once it moves a few pixels
			    and a finger after a short press, so a tap still renames it; a
			    keyboard moves it from its menu. */}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer drags the lane by its header; a keyboard has Move left and right in its menu */}
			<header
				ref={setActivatorNodeRef}
				onMouseDown={listeners?.onMouseDown as MouseEventHandler}
				onTouchStart={listeners?.onTouchStart as TouchEventHandler}
				className="flex cursor-grab touch-manipulation flex-col gap-1 px-1 pt-1 active:cursor-grabbing"
			>
				<div className="flex items-center justify-between gap-2">
					{renaming ? (
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
							<span className="ml-1.5 font-normal text-muted-foreground text-xs tabular-nums">
								{lane.todos.length}
							</span>
						</h3>
					)}
					<LaneMenu
						lane={lane}
						lanes={lanes}
						onRename={() => setRenaming(true)}
					/>
				</div>
				{lane.agents.length > 0
					? lane.agents.map((agent) => {
							const on = lane.todos
								.filter((todo) => todo.takenBy === agent)
								.map((todo) => `#${todo.id}`)
								.join(", ");
							return (
								<span key={agent} className="flex min-w-0 items-center gap-1.5">
									<button
										type="button"
										onClick={() => openTask(agent)}
										{...still}
										className="inline-flex min-w-0 pointer-coarse:min-h-10 cursor-pointer items-center gap-1 rounded text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
									>
										<TaskIcon aria-hidden className="size-3" />
										<span className="truncate">
											{agent} on {on}
										</span>
									</button>
									<OnIt task={agent} />
								</span>
							);
						})
					: lane.next !== null && <StartLane id={lane.id} />}
				<Refusal refusal={refusedLanes.get(lane.id)} />
			</header>
			<Cards
				todos={lane.todos}
				label={`${lane.name} todos`}
				staleness={staleness}
				steps
				coming={lit && laneOfCard(todos, active?.id) !== lane.id}
			/>
			<AddTodo lane={lane.id} />
		</Column>
	);
}

/**
 * While no agent is on lane `id`, puts one on it with `[ARBOR LANE <n>]`,
 * which starts at the top and works down: in a conversation, or, while the
 * page holds none, copied to paste into an agent's chat. For null, the
 * Untriaged column, `[ARBOR LANE untriaged]`, which places its todos in
 * lanes and then works those down.
 */
function StartLane({ id }: { id: number | null }): JSX.Element {
	const { copied, copy } = useCopy();
	const reference = laneReference(id);
	if (useContext(Dispatching) !== null) {
		return <StartMenu assignment={{ kind: "lane", id }} label="Start lane" />;
	}
	return (
		<Button
			size="xs"
			variant="outline"
			className="w-fit bg-transparent pointer-coarse:h-10 pointer-coarse:px-3"
			onClick={() => copy(reference)}
			title={
				copied.state === "failed"
					? copied.error
					: `No agent is on it yet. Copies ${reference} to paste into an agent's chat`
			}
		>
			{copied.state === "copied" ? (
				<CheckIcon data-icon="inline-start" />
			) : (
				<CopyIcon data-icon="inline-start" />
			)}
			<span aria-live="polite">{copiedLabel(copied, "Start lane")}</span>
		</Button>
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
	const [name, setName] = useState(lane.name);
	const save = () => {
		if (name.trim() === "" || name.trim() === lane.name) {
			onDone();
			return;
		}
		void renameLane(lane.id, name)
			.catch((error: unknown) => refuseLane(lane.id, "Not renamed", error))
			.then(onDone);
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
				<span className="font-normal text-muted-foreground text-xs tabular-nums">
					{lane.todos.length}
				</span>
			</h3>
			<ol className="flex flex-col gap-1.5">
				{lane.todos.map((todo, i) => (
					<li key={todo.id}>
						<Card todo={todo} staleness={staleness} step={i + 1} />
					</li>
				))}
			</ol>
		</section>
	);
}

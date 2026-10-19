import type { TaskRecord } from "@stringsync/splates-server/board";
import {
	holdsBack,
	queueOrder,
} from "@stringsync/splates-server/queue/browser";
import {
	ChevronDownIcon,
	ChevronUpIcon,
	ListPlusIcon,
	ListXIcon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { moveInQueue, queueTodo } from "./api";
import { Board, still, touchArea } from "./board";
import { movedInQueue, queued } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { Column } from "./lane-column";
import { Refusal } from "./refusal";

/** The stages a todo shows, in the order a lane's header counts them. */
const STAGES = ["running", "queued", "ready", "backlog"] as const;

type Stage = (typeof STAGES)[number];

/** Where `todo` stands: running once an agent has taken it, whatever it was queued as. */
export function stageOf(todo: TaskRecord): Stage {
	return todo.takenBy !== null ? "running" : todo.stage;
}

/** Where a waiting `todo` stands as a word, and its place in `queue` when queued. */
function stageLabel(todo: TaskRecord, queue: readonly TaskRecord[]): string {
	const stage = stageOf(todo);
	const word = `${stage[0]?.toUpperCase()}${stage.slice(1)}`;
	const place = queue.findIndex((each) => each.id === todo.id);
	return stage === "queued" && place !== -1 ? `${word} · ${place + 1}` : word;
}

/**
 * Where a waiting todo stands, in a quiet badge on its card; a running one
 * says who took it instead, so it has none.
 */
export function StageBadge({ todo }: { todo: TaskRecord }): JSX.Element | null {
	const { todos } = useContext(Board);
	if (stageOf(todo) === "running") {
		return null;
	}
	return (
		<Badge
			variant="outline"
			className="h-4 px-1.5 font-normal text-muted-foreground"
		>
			{stageLabel(todo, todo.stage === "queued" ? queueOrder(todos) : [])}
		</Badge>
	);
}

/** How many of `todos` are in each stage, as "1 running · 2 queued", leaving out none. */
export function StageCounts({
	todos,
	className,
}: {
	todos: readonly TaskRecord[];
	className?: string;
}): JSX.Element {
	const counts = STAGES.map(
		(stage) =>
			[stage, todos.filter((todo) => stageOf(todo) === stage).length] as const,
	).filter(([, count]) => count > 0);
	return (
		<span
			className={cn(
				"font-normal text-muted-foreground text-xs tabular-nums",
				className,
			)}
		>
			{counts.map(([stage, count]) => `${count} ${stage}`).join(" · ")}
		</span>
	);
}

/**
 * The board's queue writes, each shown at once and refused on the todo's
 * card, or by `refuse` where the control that made it says so itself.
 */
export function useQueueing(refuse?: (title: string, error: unknown) => void): {
	/** Queues `todo`, or takes it out of the queue. */
	setQueued: (todo: TaskRecord, queue: boolean) => void;
	/** Puts queued todo `id` at `position`, refused on todo `on`'s card. */
	move: (id: number, position: number) => void;
} {
	const { refuseTodo } = useContext(Board);
	const expect = useExpectSnapshot();
	const refused = (id: number, title: string) => (error: unknown) =>
		refuse ? refuse(title, error) : refuseTodo(id, title, error);
	return {
		setQueued: (todo, queue) =>
			void expect(queued(todo.id, queue), queueTodo(todo.id, queue)).catch(
				refused(todo.id, queue ? "Not queued" : "Not unqueued"),
			),
		move: (id, position) =>
			void expect(movedInQueue(id, position), moveInQueue(id, position)).catch(
				refused(id, "Not moved"),
			),
	};
}

/**
 * Queue for a waiting todo, Unqueue for a queued one; nothing for one under
 * way, which is past the queue.
 */
export function QueueToggle({
	todo,
	quiet = false,
	refuse,
}: {
	todo: TaskRecord;
	/** A card's: plain text on its line rather than a button. */
	quiet?: boolean;
	refuse?: (title: string, error: unknown) => void;
}): JSX.Element | null {
	const { setQueued } = useQueueing(refuse);
	const stage = stageOf(todo);
	if (stage === "running") {
		return null;
	}
	const queue = stage !== "queued";
	const Icon = queue ? ListPlusIcon : ListXIcon;
	const label = queue ? "Queue" : "Unqueue";
	if (quiet) {
		return (
			<button
				type="button"
				aria-label={`${label} #${todo.id}`}
				onClick={() => setQueued(todo, queue)}
				{...still}
				// Brought out by hover, as the grip is, so every card's line
				// stays quiet; always there on a touch screen.
				className={cn(
					"relative inline-flex cursor-pointer items-center gap-1 rounded opacity-0 pointer-coarse:opacity-100 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
					touchArea,
				)}
			>
				<Icon aria-hidden className="size-3" />
				{label}
			</button>
		);
	}
	return (
		<Button
			size="xs"
			variant="outline"
			onClick={() => setQueued(todo, queue)}
			className="w-fit bg-transparent pointer-coarse:h-10 pointer-coarse:px-3"
		>
			<Icon data-icon="inline-start" />
			{label}
		</Button>
	);
}

/**
 * The queue, the board's first column: the queued todos in the order
 * workers start them, each with what still holds it back, to move up or
 * down or take out. Its order is the list's, so moving one here moves it
 * there too.
 */
export function QueueColumn({
	all,
	only,
}: {
	/** Every todo, to say what each queued one waits on. */
	all: readonly TaskRecord[];
	/** The todos the board is narrowed to, or null for every one. */
	only: readonly number[] | null;
}): JSX.Element {
	const whole = queueOrder(all);
	const queue =
		only === null ? whole : whole.filter((todo) => only.includes(todo.id));
	return (
		<Column label="Queue" drop={null} lit={false}>
			<header className="flex flex-col gap-1 px-1 pt-1">
				<h3 className="flex items-baseline gap-1.5 font-medium text-sm">
					Queue
					<span className="font-normal text-muted-foreground text-xs tabular-nums">
						{queue.length}
					</span>
				</h3>
			</header>
			{queue.length === 0 ? (
				<p className="px-1 py-2 text-muted-foreground text-xs">
					Nothing queued. A queued task starts on a worker once nothing blocks
					it.
				</p>
			) : (
				<ol
					aria-label="Queued tasks"
					className="-mx-1 flex min-h-2 flex-col gap-1.5 overflow-y-auto px-1 py-0.5"
				>
					{queue.map((todo) => (
						<QueueRow key={todo.id} todo={todo} whole={whole} all={all} />
					))}
				</ol>
			)}
		</Column>
	);
}

/** One queued todo: its place, what holds it back, and ways to move it. */
function QueueRow({
	todo,
	whole,
	all,
}: {
	todo: TaskRecord;
	whole: readonly TaskRecord[];
	all: readonly TaskRecord[];
}): JSX.Element {
	const board = useContext(Board);
	const { setQueued, move } = useQueueing();
	const at = whole.findIndex((each) => each.id === todo.id);
	const next = whole[at + 1];
	const { open, lost } = holdsBack(todo, all);
	return (
		<li className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card px-2 py-1.5 text-card-foreground">
			<div className="flex items-start gap-2">
				<span className="w-4 shrink-0 pt-0.5 text-muted-foreground/70 text-xs tabular-nums">
					{at + 1}
				</span>
				<button
					type="button"
					onClick={() => board.open(todo.id)}
					className="min-w-0 flex-1 cursor-pointer rounded text-left font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<span className="mr-1 font-normal text-muted-foreground tabular-nums">
						#{todo.id}
					</span>
					{todo.subject}
				</button>
				<span className="flex shrink-0 items-center">
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`Move #${todo.id} up`}
						disabled={at <= 0}
						onClick={() => move(todo.id, at)}
					>
						<ChevronUpIcon />
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`Move #${todo.id} down`}
						disabled={next === undefined}
						onClick={() => move(todo.id, at + 2)}
					>
						<ChevronDownIcon />
					</Button>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`Unqueue #${todo.id}`}
						onClick={() => setQueued(todo, false)}
					>
						<ListXIcon />
					</Button>
				</span>
			</div>
			{(open.length > 0 || lost.length > 0) && (
				<p className="pl-6 text-muted-foreground text-xs">
					{open.length > 0 &&
						`waits on ${open.map((other) => `#${other.id}`).join(", ")}`}
					{open.length > 0 && lost.length > 0 && "; "}
					{lost.length > 0 && (
						<span className="text-warning">
							{`needs you: ${lost.map((id) => `#${id}`).join(", ")} was removed`}
						</span>
					)}
				</p>
			)}
			<Refusal refusal={board.refusedTodos.get(todo.id)} className="pl-6" />
		</li>
	);
}

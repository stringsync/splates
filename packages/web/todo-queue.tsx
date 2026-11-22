import type { TaskRecord } from "@splates/server/board";
import { cleared, deferralBlockers } from "@splates/server/board/browser";
import { isBlocked } from "@splates/server/queue/browser";
import { HourglassIcon, ListPlusIcon, ListXIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { queueTodo } from "./api";
import { upNext } from "./blocked-fix";
import { Board, still, touchArea } from "./board";
import { queued } from "./board-expectations";
import { Dispatching } from "./dispatching";
import { useExpectSnapshot, usePendingSnapshot } from "./expecting";
import { PendingSpinner, useShowPending } from "./pending";
import { TONE_CHIPS, type Tone } from "./task-sections";

/** The stages a todo shows, in the order a lane's header counts them. */
const STAGES = [
	"running",
	"queued",
	"blocked",
	"stalled",
	"available",
] as const;

type Stage = (typeof STAGES)[number];

/** Where `todo` stands: running once an agent has taken it, whatever it was queued as. */
export function stageOf(
	todo: TaskRecord,
): Exclude<Stage, "blocked" | "stalled"> {
	return todo.takenBy !== null ? "running" : todo.stage;
}

/** Whether `todo`'s agent deferred it and something it waits on is still open. */
export function deferredOpen(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
): boolean {
	return (
		todo.deferred !== undefined &&
		deferralBlockers(todo, todos).some((each) => !cleared(each))
	);
}

/**
 * Where `todo` stands as the page shows it, among `todos`: as `stageOf`,
 * but blocked for a queued one that cannot start until the person queues
 * what it waits on or drops a link, and for a taken one whose agent deferred
 * it. Given `live`, the tasks that exist, a taken one whose task is gone is
 * stalled, so finished work is not mistaken for work in progress.
 */
export function shownStage(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
	live?: readonly string[],
): Stage {
	const stage = stageOf(todo);
	if (stage === "running") {
		if (deferredOpen(todo, todos)) {
			return "blocked";
		}
		if (
			live !== undefined &&
			todo.takenBy !== null &&
			!live.includes(todo.takenBy)
		) {
			return "stalled";
		}
	}
	return stage === "queued" && isBlocked(todo, todos) ? "blocked" : stage;
}

/** Where a waiting `todo` stands as a word among `todos`, and its place in the queue when queued to start. */
export function stageLabel(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
	live?: readonly string[],
): string {
	const stage = shownStage(todo, todos, live);
	const queue = stage === "queued" ? upNext(todos) : [];
	const word = `${stage[0]?.toUpperCase()}${stage.slice(1)}`;
	const place = queue.findIndex((each) => each.id === todo.id);
	return stage === "queued" && place !== -1 ? `${word} · ${place + 1}` : word;
}

/** How each stage reads, in the task dialog's tones. */
export const STAGE_TONES: Record<Stage, Tone> = {
	running: "working",
	queued: "working",
	blocked: "waiting",
	stalled: "failed",
	available: "quiet",
};

/** A stage as a chip: its tone's tint behind plain text, a dot in the tone's color first. */
export function StageChip({
	stage,
	children,
}: {
	stage: Stage;
	children: ReactNode;
}): JSX.Element {
	const { chip, dot } = TONE_CHIPS[STAGE_TONES[stage]];
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-px font-medium text-foreground text-xs",
				chip,
			)}
		>
			<span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
			{children}
		</span>
	);
}

/** Where a todo stands, in a chip on its card. */
export function StageBadge({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos, tasks } = useContext(Board);
	return (
		<StageChip stage={shownStage(todo, todos, tasks)}>
			{stageLabel(todo, todos, tasks)}
		</StageChip>
	);
}

/**
 * A queued todo under way as far as the person is concerned, though no
 * agent has it yet: an hourglass and its place in the queue, where a card
 * at work spins, until the conversation held for it shows where it waits.
 */
export function QueuedMark({
	todo,
	className,
}: {
	todo: TaskRecord;
	className?: string;
}): JSX.Element | null {
	const { todos } = useContext(Board);
	const dispatching = useContext(Dispatching);
	// A blocked one has no place in line: its card says what it needs.
	const place = upNext(todos).findIndex((each) => each.id === todo.id);
	if (
		stageOf(todo) !== "queued" ||
		place === -1 ||
		// Its held conversation says where it waits instead.
		(dispatching?.dispatch.heldFor(todo.id).length ?? 0) > 0
	) {
		return null;
	}
	return (
		<span
			role="img"
			aria-label={`Queued, ${place + 1} in line for an agent`}
			title={`Queued, ${place + 1} in line for an agent`}
			className={cn(
				"inline-flex items-center gap-0.5 text-muted-foreground text-xs tabular-nums",
				className,
			)}
		>
			<HourglassIcon aria-hidden className="size-3" />
			{place + 1}
		</span>
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
	// What blocks one may sit in another lane, so the whole board decides.
	const board = useContext(Board);
	const all = board.linked ? board.todos : todos;
	const counts = STAGES.map(
		(stage) =>
			[
				stage,
				todos.filter((todo) => shownStage(todo, all, board.tasks) === stage)
					.length,
			] as const,
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

const BAR_COLORS: Record<Stage, string> = {
	running: "bg-success",
	queued: "bg-primary/50",
	blocked: "bg-warning",
	stalled: "bg-destructive",
	available: "bg-border",
};

/**
 * A lane's tasks as one bar, a segment each in the colors of their stages,
 * in the order the counts above it read, so how far a lane has come and
 * what holds it up show before a card is read.
 */
export function StageBar({
	todos,
	className,
}: {
	todos: readonly TaskRecord[];
	className?: string;
}): JSX.Element {
	const board = useContext(Board);
	const all = board.linked ? board.todos : todos;
	return (
		<div
			role="presentation"
			className={cn(
				"flex h-1.5 gap-px overflow-hidden rounded-full",
				className,
			)}
		>
			{STAGES.flatMap((stage) =>
				todos
					.filter((todo) => shownStage(todo, all, board.tasks) === stage)
					.map((todo) => (
						<span
							key={todo.id}
							className={cn("h-full flex-1", BAR_COLORS[stage])}
						/>
					)),
			)}
		</div>
	);
}

/**
 * Queue for a waiting todo, Unqueue for a queued one, as plain text on its
 * card's line; nothing for one under way, which is past the queue. One
 * queued while what it waits on is not shows as blocked, its card offering
 * to queue that. A refusal is said on the card.
 */
export function QueueToggle({
	todo,
	phone,
}: {
	todo: TaskRecord;
	/** Set to draw a round icon button for a list row (taller on the phone). */
	phone?: boolean;
}): JSX.Element | null {
	const { refuseTodo } = useContext(Board);
	const expect = useExpectSnapshot();
	const pending = usePendingSnapshot(`todo:${todo.id}`);
	const shown = useShowPending(pending);
	const stage = stageOf(todo);
	if (stage === "running") {
		return null;
	}
	const queue = stage !== "queued";
	const Icon = queue ? ListPlusIcon : ListXIcon;
	const label = queue ? "Queue" : "Unqueue";
	const row = phone !== undefined;
	return (
		<button
			type="button"
			aria-label={`${label} #${todo.id}`}
			title={row ? label : undefined}
			disabled={pending}
			aria-busy={pending}
			onClick={() =>
				void expect(queued(todo.id, queue), queueTodo(todo.id, queue)).catch(
					(error: unknown) =>
						refuseTodo(todo.id, queue ? "Not queued" : "Not unqueued", error),
				)
			}
			{...still}
			// Brought out by hover, as the grip is, so every card's line
			// stays quiet; always there on a touch screen.
			className={cn(
				row
					? "flex shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					: "relative inline-flex cursor-pointer items-center gap-1 rounded opacity-0 pointer-coarse:opacity-100 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
				!row && touchArea,
				row && !phone && "size-6",
				row && phone && "size-11",
			)}
		>
			{shown ? (
				<PendingSpinner shown className={row ? "size-4" : "size-3"} />
			) : (
				<Icon aria-hidden className={row ? "size-4" : "size-3"} />
			)}
			{row ? null : label}
		</button>
	);
}

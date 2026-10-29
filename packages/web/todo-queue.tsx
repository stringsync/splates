import type { TaskRecord } from "@stringsync/splates-server/board";
import { isBlocked } from "@stringsync/splates-server/queue/browser";
import { HourglassIcon, ListPlusIcon, ListXIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { cn } from "#web/lib/utils.ts";
import { queueTodo } from "./api";
import { upNext } from "./blocked-fix";
import { Board, still, touchArea } from "./board";
import { queued } from "./board-expectations";
import { Dispatching } from "./dispatching";
import { useExpectSnapshot } from "./expecting";
import { TONES, type Tone } from "./task-sections";

/** The stages a todo shows, in the order a lane's header counts them. */
const STAGES = ["running", "queued", "blocked", "ready", "backlog"] as const;

type Stage = (typeof STAGES)[number];

/** Where `todo` stands: running once an agent has taken it, whatever it was queued as. */
export function stageOf(todo: TaskRecord): Exclude<Stage, "blocked"> {
	return todo.takenBy !== null ? "running" : todo.stage;
}

/**
 * Where `todo` stands as the page shows it, among `todos`: as `stageOf`,
 * but blocked for a queued one that cannot start until the person queues
 * what it waits on or drops a link.
 */
export function shownStage(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
): Stage {
	const stage = stageOf(todo);
	return stage === "queued" && isBlocked(todo, todos) ? "blocked" : stage;
}

/** Where a waiting `todo` stands as a word among `todos`, and its place in the queue when queued to start. */
export function stageLabel(
	todo: TaskRecord,
	todos: readonly TaskRecord[],
): string {
	const stage = shownStage(todo, todos);
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
	ready: "ready",
	backlog: "quiet",
};

/** Where a todo stands, in a badge on its card toned as in its task dialog. */
export function StageBadge({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos } = useContext(Board);
	return (
		<span
			className={cn(
				"shrink-0 rounded-md px-1.5 py-px font-medium text-xs",
				TONES[STAGE_TONES[shownStage(todo, todos)]],
			)}
		>
			{stageLabel(todo, todos)}
		</span>
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
				todos.filter((todo) => shownStage(todo, all) === stage).length,
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

/**
 * Queue for a waiting todo, Unqueue for a queued one, as plain text on its
 * card's line; nothing for one under way, which is past the queue. One
 * queued while what it waits on is not shows as blocked, its card offering
 * to queue that. A refusal is said on the card.
 */
export function QueueToggle({
	todo,
}: {
	todo: TaskRecord;
}): JSX.Element | null {
	const { refuseTodo } = useContext(Board);
	const expect = useExpectSnapshot();
	const stage = stageOf(todo);
	if (stage === "running") {
		return null;
	}
	const queue = stage !== "queued";
	const Icon = queue ? ListPlusIcon : ListXIcon;
	const label = queue ? "Queue" : "Unqueue";
	return (
		<button
			type="button"
			aria-label={`${label} #${todo.id}`}
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
				"relative inline-flex cursor-pointer items-center gap-1 rounded opacity-0 pointer-coarse:opacity-100 outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100",
				touchArea,
			)}
		>
			<Icon aria-hidden className="size-3" />
			{label}
		</button>
	);
}

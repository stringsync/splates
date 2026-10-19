import type { TaskRecord } from "@stringsync/splates-server/board";
import { queueOrder } from "@stringsync/splates-server/queue/browser";
import { HourglassIcon, ListPlusIcon, ListXIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { queueTodo } from "./api";
import { Board, still, touchArea } from "./board";
import { queued } from "./board-expectations";
import { Dispatching } from "./dispatching";
import { useExpectSnapshot } from "./expecting";

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
	const place = queueOrder(todos).findIndex((each) => each.id === todo.id);
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
 * The board's queue write, shown at once and refused on the todo's card,
 * or by `refuse` where the control that made it says so itself.
 */
export function useQueueing(refuse?: (title: string, error: unknown) => void): {
	/** Queues `todo`, or takes it out of the queue. */
	setQueued: (todo: TaskRecord, queue: boolean) => void;
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

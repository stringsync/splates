import type { TaskRecord } from "@splates/server/board";
import { elsewhereName } from "@splates/server/board/browser";
import { taskNumberReference } from "@splates/server/plans/browser";
import { holdsBack } from "@splates/server/queue/browser";
import { CircleAlertIcon, MessageSquareIcon } from "lucide-react";
import {
	type HTMLAttributes,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import { cn } from "#web/lib/utils.ts";
import { BlockedFixButton, blockedFix } from "./blocked-fix";
import { Board, still, touchArea } from "./board";
import { Dispatching } from "./dispatching";
import { LaneChip } from "./lane-chip";
import { Refusal } from "./refusal";
import { QueueToggle, shownStage } from "./todo-queue";

export interface CardProps {
	todo: TaskRecord;
	staleness: number;
	pointer?: HTMLAttributes<HTMLElement>;
	/** The title's keyboard handle for a drag, which the card as a whole has no need of. */
	grip?: HTMLAttributes<HTMLButtonElement> & {
		ref?: (element: HTMLElement | null) => void;
	};
	/** On the Queue board: names its lane below the title, and cannot be dragged since it stays put. */
	listed?: boolean;
	/** A fact the card's list adds below the title, as how long it has waited. */
	detail?: ReactNode;
	/** Hears which tasks its blocked fix queued, for a list it leaves once unblocked. */
	onFixed?: (ids: number[]) => void;
	className?: string;
}

export function Card({
	todo,
	staleness,
	pointer,
	grip,
	listed = false,
	detail,
	onFixed,
	className,
}: CardProps): JSX.Element {
	const board = useContext(Board);
	// Queued, it has a conversation waiting for an agent once it can start,
	// as one at work has.
	const held = todo.takenBy === null && todo.stage === "queued";
	const waiting = held ? holdsBack(todo, board.todos) : null;
	const blockers =
		waiting === null
			? []
			: [
					...waiting.open.map((blocker) => `#${blocker.id}`),
					...waiting.elsewhere.map((blocker) => elsewhereName(blocker)),
				];
	const shown = shownStage(todo, board.todos, board.tasks);
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	// Downstream blocked cards wait on another blocked card's fix, so they
	// present quietly as Queued rather than repeating Blocked.
	const fix = held ? blockedFix(todo, board.todos) : null;
	const badgeStage =
		shown === "blocked" && fix?.kind === "with" ? "queued" : shown;
	const badge =
		shown === "blocked" && badgeStage === "queued"
			? BLOCKED_QUEUED_BADGE
			: STATUS_BADGE[badgeStage];
	// Cross-lane or unqueued blockers on an available task still show a quiet
	// warning mark since available cards carry no status badge.
	const trouble =
		shown === "available" &&
		(board.todos.some(
			(other) =>
				todo.blockedBy.includes(other.id) &&
				(todo.lane === null || other.lane !== todo.lane),
		) ||
			(todo.unqueuedFor ?? []).some((id) => todo.blockedBy.includes(id)));
	return (
		<div
			{...pointer}
			className={cn(
				// A pointer, since a tap opens it; a drag from anywhere still moves it.
				"group relative flex cursor-pointer touch-manipulation flex-col gap-1.5 rounded-lg border border-transparent bg-card px-2.5 py-2 text-card-foreground shadow-[0_1px_0_rgb(9_30_66/0.25)] transition-colors select-none hover:border-ring/60 active:bg-muted/50",
				className,
			)}
		>
			<div className="flex min-h-5 items-center justify-between gap-2 text-muted-foreground text-xs">
				<span className="flex min-w-0 items-center gap-1.5">
					<CopyLink id={todo.id} />
					{badge !== undefined && (
						<span
							data-status={badgeStage}
							className={cn(
								"inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-px font-medium text-xs",
								badge.chip,
							)}
						>
							<span
								aria-hidden
								className={cn("size-1.5 shrink-0 rounded-full", badge.dot)}
							/>
							{badge.label}
						</span>
					)}
					{trouble && (
						<CircleAlertIcon
							aria-label="Needs attention"
							className="size-3 shrink-0 text-warning"
						/>
					)}
				</span>
				<span className="relative flex shrink-0 items-center gap-0.5">
					<QueueToggle todo={todo} phone={false} />
					<ViewButton todo={todo} />
				</span>
			</div>
			{/* Stretched over the whole card, so a tap anywhere opens it; the
			    buttons on top of it keep their own. */}
			<button
				type="button"
				{...grip}
				onClick={() => board.open(todo.id)}
				className={cn(
					"cursor-pointer text-left text-sm wrap-anywhere outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring",
					stale && "opacity-60",
				)}
			>
				{todo.subject}
			</button>
			{blockers.length > 0 && (
				<p className="text-muted-foreground text-xs">
					{blockers.length === 1
						? `Waiting on ${blockers[0]}`
						: `Waiting on ${blockers.length} blockers`}
				</p>
			)}
			{listed && <LaneChip lane={todo.lane} plain />}
			{detail !== undefined && detail !== null && (
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
					{detail}
				</div>
			)}
			{held && <BlockedFixButton todo={todo} onFixed={onFixed} card />}
			<Refusal refusal={board.refusedTodos.get(todo.id)} />
		</div>
	);
}

/** The status badge shown beside the task id at the top of a card; none while available. */
const STATUS_BADGE: Partial<
	Record<
		ReturnType<typeof shownStage>,
		{ label: string; chip: string; dot: string }
	>
> = {
	running: {
		label: "Running",
		chip: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
		dot: "bg-green-600 dark:bg-green-400",
	},
	queued: {
		label: "Queued",
		chip: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
		dot: "bg-teal-600 dark:bg-teal-400",
	},
	blocked: {
		label: "Blocked",
		chip: "bg-warning/15 text-foreground",
		dot: "bg-warning",
	},
	stalled: {
		label: "Stalled",
		chip: "bg-destructive/15 text-foreground",
		dot: "bg-destructive",
	},
};

const BLOCKED_QUEUED_BADGE = {
	label: "Queued",
	chip: "bg-foreground/[0.07] text-muted-foreground",
	dot: "bg-muted-foreground",
};

/**
 * Opens the conversation working the task, or the one the queue holds for
 * it; there is nothing to show without one.
 */
function ViewButton({ todo }: { todo: TaskRecord }): JSX.Element | null {
	const dispatching = useContext(Dispatching);
	if (dispatching === null) {
		return null;
	}
	const { dispatch, open } = dispatching;
	const found =
		todo.takenBy !== null
			? dispatch.on(todo.takenBy)
			: dispatch.heldFor(todo.id);
	const conversation = found.find(
		(each) => each.conversation !== null,
	)?.conversation;
	if (conversation === undefined || conversation === null) {
		return null;
	}
	return (
		<button
			type="button"
			aria-label={`View conversation for #${todo.id}`}
			title="View conversation"
			onClick={() => open(conversation.id)}
			{...still}
			className={cn(
				"relative inline-flex cursor-pointer items-center justify-center rounded-md p-1 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				touchArea,
			)}
		>
			<MessageSquareIcon aria-hidden className="size-3.5" />
		</button>
	);
}

/**
 * The card's id, which copies `taskNumberReference` for pasting into a chat. Above
 * the card's own button, and never the start of a drag.
 */
export function CopyLink({ id }: { id: number }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			aria-label={`copy a link to task ${id}`}
			title={copied.state === "failed" ? copied.error : undefined}
			onClick={() => copy(taskNumberReference(id))}
			{...still}
			className={cn(
				"relative -mx-1 inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded px-1 tabular-nums outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				touchArea,
			)}
		>
			<span aria-live="polite">{copiedLabel(copied, `#${id}`)}</span>
		</button>
	);
}

/** One fact about a card: an outlined chip of plain text, with a dot colored only where the fact means something. */
export function Chip({
	dot,
	title,
	className,
	children,
}: {
	dot?: string;
	title?: string;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-px text-foreground text-xs",
				className,
			)}
		>
			{dot !== undefined && (
				<span aria-hidden className={cn("size-1.5 rounded-full", dot)} />
			)}
			{children}
		</span>
	);
}

/** How long a control that copied says so before it goes back. */
const COPIED_MS = 1500;

/** What a control that copies says for a moment after it is clicked. */
export type Copied =
	| { state: "idle" }
	| { state: "copied" }
	| { state: "failed"; error: string };

/**
 * Copies text for pasting into a chat; `copied` says how it went, for a
 * moment, so the control that was clicked can say so in place.
 */
export function useCopy(): {
	copied: Copied;
	/** Copies `text`, then once it is on the clipboard, `then`. */
	copy: (text: string, then?: () => void) => void;
} {
	const [copied, setCopied] = useState<Copied>({ state: "idle" });
	useEffect(() => {
		if (copied.state === "idle") {
			return;
		}
		const back = setTimeout(() => setCopied({ state: "idle" }), COPIED_MS);
		return () => clearTimeout(back);
	}, [copied]);
	const copy = (text: string, then?: () => void) =>
		void navigator.clipboard.writeText(text).then(
			() => {
				setCopied({ state: "copied" });
				then?.();
			},
			(error: unknown) =>
				setCopied({
					state: "failed",
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	return { copied, copy };
}

/** What a control that copies reads: `label`, or how its copy went. */
export function copiedLabel(copied: Copied, label: string): string {
	return copied.state === "copied"
		? "Copied"
		: copied.state === "failed"
			? "Not copied"
			: label;
}

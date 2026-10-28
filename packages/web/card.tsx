import { age } from "@stringsync/splates-server/age";
import type { TaskRecord } from "@stringsync/splates-server/board";
import {
	blockerLabel,
	type DeferralBlocker,
} from "@stringsync/splates-server/board/browser";
import { taskNumberReference } from "@stringsync/splates-server/plans/browser";
import {
	CircleAlertIcon,
	ClockIcon,
	GripVerticalIcon,
	HourglassIcon,
	type LucideIcon,
	PaperclipIcon,
} from "lucide-react";
import {
	type HTMLAttributes,
	type JSX,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#web/components/ui/tooltip.tsx";
import { cn } from "#web/lib/utils.ts";
import { AUTO_PICK_NAME, AutoIcon } from "./auto-brand";
import { Elsewhere, heldElsewhere } from "./blocked-elsewhere";
import { Board, still, touchArea } from "./board";
import { openForPerson } from "./deferred-body";
import { OnIt } from "./dispatching";
import { Markdown } from "./markdown";
import { Refusal } from "./refusal";
import { StartAssigned } from "./start-menu";
import { QueuedMark, QueueToggle, StageBadge } from "./todo-queue";
import { waitLines, waitsOn, waitsShort } from "./waits-on";

export interface CardProps {
	todo: TaskRecord;
	staleness: number;
	/** Its place in its lane, 1 at the top, when it is in one. */
	step?: number;
	pointer?: HTMLAttributes<HTMLElement>;
	grip?: HTMLAttributes<HTMLButtonElement> & {
		ref?: (element: HTMLElement | null) => void;
	};
	className?: string;
}

export function Card({
	todo,
	staleness,
	step,
	pointer,
	grip,
	className,
}: CardProps): JSX.Element {
	const board = useContext(Board);
	// Queued, it has a conversation waiting for an agent once it can start,
	// as one at work has.
	const held = todo.takenBy === null && todo.stage === "queued";
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	// What blocks it that its own lane's order does not already say.
	const blockers = board.todos.filter(
		(other) =>
			todo.blockedBy.includes(other.id) &&
			(todo.lane === null || other.lane !== todo.lane),
	);
	// What a deferral waits on that is no task: the person's answers or something outside.
	const awaited =
		todo.deferred === undefined ? [] : openForPerson(todo, board.todos);
	// Queued, the tasks here it waits on to start, its own lane's included,
	// named on the card; those removed or elsewhere have badges of their own.
	const waits = held
		? waitsOn(todo, board.todos, board.lanes).filter(
				(wait) => wait.state !== "removed" && wait.state !== "another project",
			)
		: [];
	// The blockers the queue let it go for that still block it, to queue first.
	const leftFor =
		todo.stage === "queued"
			? []
			: (todo.unqueuedFor ?? []).filter((id) => todo.blockedBy.includes(id));
	return (
		<div
			{...pointer}
			className={cn(
				// A pointer, since a tap opens it; a drag from anywhere still moves
				// it, and the grip says so with its own cursor.
				"group relative flex cursor-pointer touch-manipulation items-stretch rounded-lg border border-border/60 bg-card text-card-foreground transition-colors select-none hover:border-border active:border-border active:bg-muted/50",
				// Queued, waiting for an agent, or at work, it stands out from the
				// rest of its lane in the same way.
				(held || todo.takenBy) &&
					"border-muted-foreground/60 bg-muted/60 hover:border-muted-foreground active:border-muted-foreground",
				className,
			)}
		>
			{step !== undefined && (
				<span
					aria-hidden
					className="flex w-7 shrink-0 justify-center pt-2.5 text-muted-foreground/70 text-xs tabular-nums"
				>
					{step}
				</span>
			)}
			<div
				className={cn(
					// Room on a touch screen for the taller taps of the line below.
					"flex min-w-0 flex-1 flex-col gap-1 py-2 pointer-coarse:gap-2",
					step === undefined && "pl-3",
					stale && "opacity-60",
				)}
			>
				{/* Stretched over the whole card, so a tap anywhere opens it; the
				    buttons on top of it keep their own. */}
				<button
					type="button"
					onClick={() => board.open(todo.id)}
					className="cursor-pointer text-left font-medium text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
				>
					{todo.subject}
				</button>
				{/* A lane is read down the column, so its cards keep to their
				    subject; the detail is a tap away. */}
				{todo.text !== "" && step === undefined && (
					<Markdown
						text={todo.text}
						preview
						className="text-muted-foreground text-xs"
					/>
				)}
				{/* One quiet line of what there is to know, in plain text. */}
				<span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
					<CopyLink id={todo.id} />
					{todo.slug !== undefined && (
						<span className="min-w-0 truncate" title="Its slug">
							{todo.slug}
						</span>
					)}
					<StageBadge todo={todo} />
					{/* Groomed with no agent named, it runs on whichever is picked then. */}
					{todo.takenBy === null &&
						todo.stage === "ready" &&
						todo.assignee === undefined && (
							<span className="inline-flex items-center gap-1">
								<AutoIcon className="size-3" />
								{AUTO_PICK_NAME}
							</span>
						)}
					{waits.length > 0 ? (
						<span
							className="inline-flex min-w-0 items-center gap-1 text-warning"
							title={waitLines(waits)}
						>
							<HourglassIcon aria-hidden className="size-3 shrink-0" />
							<span className="truncate">{waitsShort(waits)}</span>
						</span>
					) : (
						blockers.length > 0 && <Blocked by={blockers} />
					)}
					<Elsewhere todo={todo} />
					{blockers.length === 0 && awaited.length > 0 && (
						<Awaited on={awaited} />
					)}
					{(todo.blockersLost ?? []).length > 0 && (
						<Badge Icon={CircleAlertIcon} label="a blocker was removed">
							<span className="text-warning">needs you</span>
						</Badge>
					)}
					{leftFor.length > 0 && (
						<Badge
							Icon={CircleAlertIcon}
							label="the queue let it go: what it waits on is not queued"
						>
							<span className="text-warning">
								left the queue: queue {leftFor.map((id) => `#${id}`).join(", ")}{" "}
								first
							</span>
						</Badge>
					)}
					{todo.files.length > 0 && (
						<Badge Icon={PaperclipIcon} label="files">
							{todo.files.length}
						</Badge>
					)}
					{/* Its assigned agent starts it in one tap; one blocked waits. */}
					{todo.takenBy === null &&
						todo.assignee &&
						blockers.length === 0 &&
						(todo.blockersLost ?? []).length === 0 &&
						!heldElsewhere(todo) && (
							<StartAssigned
								assignment={{ kind: "todo", id: todo.id }}
								assignee={todo.assignee}
								quiet
							/>
						)}
					<QueueToggle todo={todo} />
					{stale && (
						<Badge Icon={ClockIcon} label="stale">
							stale, {age(todo.createdAt)}
						</Badge>
					)}
				</span>
				<Refusal refusal={board.refusedTodos.get(todo.id)} />
			</div>
			<button
				type="button"
				{...grip}
				aria-label={`move ${todo.subject}`}
				// Shown on a touch screen, which has no hover to bring it out.
				className="relative flex w-7 pointer-coarse:w-10 shrink-0 cursor-grab items-center active:cursor-grabbing justify-center rounded-r-lg text-muted-foreground opacity-0 pointer-coarse:opacity-60 outline-none group-hover:opacity-60 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
			>
				<GripVerticalIcon className="size-4" />
			</button>
			{/* An agent at work spins in the top right, on every card the same
			    place, in the grip's column so the subject keeps its width; a
			    queued card free to start waits there for one. */}
			{(todo.takenBy || held) && (
				<OnIt
					task={todo.takenBy}
					queued={held ? todo.id : undefined}
					spinning
					className="absolute top-2 right-0 w-7 pointer-coarse:w-10 flex-col"
				/>
			)}
			<QueuedMark
				todo={todo}
				className="absolute top-2.5 right-0 w-7 pointer-coarse:w-10 justify-center"
			/>
		</div>
	);
}

/**
 * A lone hourglass saying the card cannot start yet: what blocks it has to
 * merge first. Which todos those are is in its label, on hover, and in the
 * dialog, so the card stays quiet.
 */
function Blocked({ by }: { by: TaskRecord[] }): JSX.Element {
	const { lanes } = useContext(Board);
	const label = `Blocked by ${by.map((other) => blockerLabel(other, lanes)).join(", ")}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span {...still} />}
				aria-label={label}
				className="relative inline-flex cursor-default rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<HourglassIcon aria-hidden className="size-3 text-warning" />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/**
 * A lone hourglass on a deferred card waiting on no other task: the
 * questions and outside things it waits on are in its label.
 */
function Awaited({ on }: { on: DeferralBlocker[] }): JSX.Element {
	const label = `Waiting on ${on.map((each) => (each.kind === "question" ? `your answer: ${each.text.split("\n")[0]}` : each.kind === "outside" ? each.what : "")).join("; ")}`;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span {...still} />}
				aria-label={label}
				className="relative inline-flex cursor-default rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<HourglassIcon aria-hidden className="size-3 text-warning" />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
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
				"relative -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 tabular-nums outline-none hover:bg-muted hover:text-foreground active:bg-muted active:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				touchArea,
			)}
		>
			<span aria-live="polite">{copiedLabel(copied, `#${id}`)}</span>
		</button>
	);
}

/** One fact about a card, after an icon that says what kind. */
export function Badge({
	Icon,
	label,
	children,
}: {
	Icon: LucideIcon;
	label: string;
	children: ReactNode;
}): JSX.Element {
	return (
		<span className="inline-flex items-center gap-1" title={label}>
			<Icon aria-label={label} role="img" className="size-3" />
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

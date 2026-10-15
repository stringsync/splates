import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ClockIcon,
	GripVerticalIcon,
	HourglassIcon,
	type LucideIcon,
	PaperclipIcon,
} from "lucide-react";
import {
	type HTMLAttributes,
	type JSX,
	type KeyboardEventHandler,
	type MouseEventHandler,
	type ReactNode,
	type TouchEventHandler,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#dev/components/ui/tooltip.tsx";
import { cn } from "#dev/lib/utils.ts";
import { age } from "../age";
import { blockerLabel } from "../lanes";
import { todoReference } from "../prompts";
import type { TodoState } from "../todo";
import { Board, still, touchArea } from "./board";
import { OnIt } from "./dispatching";
import { Markdown } from "./markdown";
import { Refusal } from "./refusal";
import { TaskIcon } from "./task-icon";

export interface CardProps {
	todo: TodoState;
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
	const stale =
		todo.takenBy === null &&
		Date.now() - Date.parse(todo.createdAt) > staleness;
	// What blocks it that its own lane's order does not already say.
	const blockers = board.todos.filter(
		(other) =>
			todo.blockedBy.includes(other.id) &&
			(todo.lane === null || other.lane !== todo.lane),
	);
	return (
		<div
			{...pointer}
			className={cn(
				// A pointer, since a tap opens it; a drag from anywhere still moves
				// it, and the grip says so with its own cursor.
				"group relative flex cursor-pointer touch-manipulation items-stretch rounded-lg border border-border/60 bg-card text-card-foreground transition-colors select-none hover:border-border",
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
					{blockers.length > 0 && <Blocked by={blockers} />}
					{todo.files.length > 0 && (
						<Badge Icon={PaperclipIcon} label="files">
							{todo.files.length}
						</Badge>
					)}
					{todo.takenBy && <TakenBy task={todo.takenBy} />}
					{todo.takenBy && <OnIt task={todo.takenBy} spinning={false} />}
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
			    place, in the grip's column so the subject keeps its width. */}
			{todo.takenBy && (
				<OnIt
					task={todo.takenBy}
					spinning
					className="absolute top-2 right-0 w-7 pointer-coarse:w-10 flex-col"
				/>
			)}
		</div>
	);
}

/**
 * A lone hourglass saying the card cannot start yet: what blocks it has to
 * merge first. Which todos those are is in its label, on hover, and in the
 * dialog, so the card stays quiet.
 */
function Blocked({ by }: { by: TodoState[] }): JSX.Element {
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
 * The task that took the todo, in plain text. A tap opens the task; like the
 * copy link, it sits above the card's own button and never starts a drag.
 */
export function TakenBy({ task }: { task: string }): JSX.Element {
	const { openTask } = useContext(Board);
	return (
		<button
			type="button"
			onClick={() => openTask(task)}
			{...still}
			className={cn(
				"relative inline-flex min-w-0 cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
				touchArea,
			)}
		>
			<TaskIcon aria-label="taken by" role="img" className="size-3 shrink-0" />
			<span className="truncate">{task}</span>
		</button>
	);
}

/**
 * The card's id, which copies `todoReference` for pasting into a chat. Above
 * the card's own button, and never the start of a drag.
 */
export function CopyLink({ id }: { id: number }): JSX.Element {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			aria-label={`copy a link to todo ${id}`}
			title={copied.state === "failed" ? copied.error : undefined}
			onClick={() => copy(todoReference(id))}
			{...still}
			className={cn(
				"relative -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
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

/** One card in a column, holding its place while another is dragged over it. */
export function Sortable(props: CardProps): JSX.Element {
	const { todo } = props;
	const {
		attributes,
		listeners,
		setNodeRef,
		setActivatorNodeRef,
		transform,
		transition,
		isDragging,
		isOver,
		active,
	} = useSortable({ id: todo.id });
	// A card from another column lands just above this one: a line says so,
	// since this column's cards do not move aside for it.
	const { todos } = useContext(Board);
	const coming =
		isOver &&
		todos.find((other) => other.id === active?.id)?.lane !== todo.lane;
	return (
		<li
			ref={setNodeRef}
			style={{ transform: CSS.Translate.toString(transform), transition }}
			className={cn(
				"relative",
				coming &&
					"before:absolute before:inset-x-1 before:-top-1.5 before:h-1 before:rounded-full before:bg-primary",
			)}
		>
			<Card
				{...props}
				// The card answers a mouse and a finger; its grip, a keyboard.
				pointer={{
					onMouseDown: listeners?.onMouseDown as MouseEventHandler,
					onTouchStart: listeners?.onTouchStart as TouchEventHandler,
				}}
				grip={{
					...attributes,
					onKeyDown: listeners?.onKeyDown as KeyboardEventHandler,
					ref: setActivatorNodeRef,
				}}
				// The slot it leaves while it is in hand, where it will land.
				className={cn(
					isDragging &&
						"border-dashed bg-muted shadow-none *:invisible hover:shadow-none",
				)}
			/>
		</li>
	);
}

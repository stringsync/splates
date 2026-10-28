import {
	CheckIcon,
	FileIcon,
	FilesIcon,
	GitBranchIcon,
	GitMergeConflictIcon,
	KeyRoundIcon,
	ListTodoIcon,
	type LucideIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react";
import { type JSX, type ReactNode, use, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { useOpenArtifact } from "./artifact-open";
import { Board } from "./board";
import { distinctNames } from "./file-chip";
import { OpenerContext } from "./openers";
import { credAddress } from "./page-address";
import { PendingSpinner, useShowPending } from "./pending";

import { LaneIcon, TaskIcon } from "./task-icon";

/** A single action and subject, centered between the event's two hairlines. */
export function SplatesEvent({
	event,
	lead,
	children,
}: {
	event: SplatesEventView;
	/** A logo before the verb. */
	lead?: ReactNode;
	children?: ReactNode;
}): JSX.Element | null {
	const { deadline = null } = event;
	const live = deadline !== null && !deadline.met;
	if (deadline?.met) {
		return null;
	}
	return (
		<div
			role="note"
			aria-label="splates"
			data-slot="splates-event"
			data-live={live || undefined}
			className="my-6 text-muted-foreground text-xs"
		>
			<div className="flex items-center gap-3">
				<Rule />
				<Line event={event} lead={lead}>
					{children}
				</Line>
				<Rule />
			</div>
		</div>
	);
}

/**
 * Something an event names, drawn as a chip with its kind's icon that opens it
 * where it can. `todos` names a burst of them, such as a groom's, as one
 * chip, "5 tasks", opening their list.
 */
export type Named =
	| {
			kind: "task";
			task: string;
			/** What done means for it, shown on hover, when the event knows. */
			goal?: string;
			/** More for its hover, such as why it was removed or who it went to. */
			note?: string;
	  }
	| { kind: "todo"; id: number; subject: string; note?: string }
	| {
			kind: "todos";
			todos: readonly { id: number; subject: string; note?: string }[];
	  }
	| { kind: "lane"; id: number; name: string }
	| { kind: "branch"; branch: string }
	| { kind: "file"; path: string }
	| {
			kind: "artifact";
			/** The conversation that holds it. */
			conversation: string;
			name: string;
			version: number;
	  }
	| { kind: "cred"; name: string }
	/** A shell command, as a run-command card asked to run it. */
	| { kind: "command"; command: string };

/**
 * What an event says, read in order: a verb and the thing it names, each
 * named once, so it fits one line: `["Merged", task]`. What cannot be said
 * so is not an event line.
 */
export type Words = readonly (string | Named)[];

/**
 * One thing splates did in a conversation, as its own voice in the thread
 * rather than the person's or the agent's: what it did and what it names,
 * without inline secondary details.
 */
export interface SplatesEventView {
	/** The mark leading it, its line's only color, when it has one. */
	mark?: Mark | null;
	/** What it did, as a verb and its subject: `["Merged", task]`. */
	words: Words;
	/**
	 * When, as an ISO time, to place it among the thread's messages; kept with
	 * the record, without adding a timestamp to the summary.
	 */
	at?: string | null;
	/** What the line stands for, in full, on hover: a directive's text. */
	title?: string;
	/** A wait whose completion removes the summary. */
	deadline?: Deadline | null;
	/** When the work began, retained for progress details. */
	since?: string | null;
	/** The one thing the person can do about it, when there is one. */
	act?: Act | null;
}

/**
 * A command that failed, marked by a red X, or landed or approved, by a green
 * check; or an
 * early warning of a conflict with the base or an overlap with another task,
 * each by its muted icon.
 */
export type Mark = "failed" | "landed" | "approved" | "conflict" | "overlap";

/**
 * A wait that ends at `until`. Once what it waited on comes, it is
 * `met` and its line goes, since the event that met it says so; once it times
 * out, the event is drawn in new words, `["Wait timed out", task]`, marked
 * `failed`, with no deadline.
 */
export interface Deadline {
	/** When it times out, as an ISO time. */
	until: string;
	/** Whether what it waited on came, ending it in nothing. */
	met?: boolean;
}

/** The one action an event offers, such as pasting a requested cred. */
export interface Act {
	/** A word, never an icon. */
	label: string;
	run: () => void;
	/** What it says once done, in place of the button; null until then. */
	done?: string | null;
	/** Whether its write is on its way: the button disables and spins. */
	busy?: boolean;
	/** Whether the subject has opened its existing content. */
	expanded?: boolean;
}

/**
 * One event's line: its mark, verb and one subject or action.
 */
function Line({
	event,
	lead,
	children,
}: {
	event: SplatesEventView;
	lead?: ReactNode;
	children?: ReactNode;
}): JSX.Element {
	const { mark = null, act = null } = event;
	return (
		<p
			title={event.title}
			className="flex min-w-0 max-w-[calc(100%-4.5rem)] items-center justify-center gap-1.5 whitespace-nowrap [&>a]:max-w-44 [&>button]:max-w-44 [&>span:has(svg)]:max-w-44"
		>
			{lead}
			{mark === "failed" && (
				<XIcon
					aria-label="Failed"
					className="size-3.5 shrink-0 text-destructive"
				/>
			)}
			{mark === "approved" && (
				<CheckIcon
					aria-label="Approved"
					className="size-3.5 shrink-0 text-success"
				/>
			)}
			{mark === "landed" && (
				<CheckIcon
					aria-label="Landed"
					className="size-3.5 shrink-0 text-success"
				/>
			)}
			{mark === "conflict" && (
				<GitMergeConflictIcon
					aria-label="Conflict"
					className="size-3.5 shrink-0"
				/>
			)}
			{mark === "overlap" && (
				<FilesIcon aria-label="Overlap" className="size-3.5 shrink-0" />
			)}
			<Words
				words={
					children != null || act !== null
						? event.words.slice(0, 1)
						: event.words
				}
			/>
			{children}
			{act !== null && <Action act={act} />}
		</p>
	);
}

/** Only the verb and primary subject belong in a summary; long subjects give way. */
function Words({ words }: { words: Words }): ReactNode {
	if (words.length === 1 && typeof words[0] === "string") {
		return <span className="min-w-0 truncate text-center">{words[0]}</span>;
	}
	return words.slice(0, 2).map((word, index) =>
		typeof word === "string" ? (
			<span
				// biome-ignore lint/suspicious/noArrayIndexKey: words never move
				key={index}
				className={index === 0 ? "shrink-0" : "min-w-0 truncate"}
			>
				{word}
			</span>
		) : (
			// biome-ignore lint/suspicious/noArrayIndexKey: words never move
			<NamedChip key={index} named={word} />
		),
	);
}

/**
 * How a short name, such as a task's, gives way: barely, so the long names
 * beside it are cut first, but still before the line overflows.
 */
const GIVES_WAY = "min-w-12 shrink-[0.1]";

/**
 * How a long name gives way: a todo's subject or a file's path, cut sooner than the short names beside them, such as a task's.
 */
const GIVES_WAY_FIRST = "min-w-12 shrink-[4]";

/**
 * A thing an event names, by its kind's icon and its name, with no "Task" or
 * "Lane 27" before it as elsewhere, so its line stays short and quiet. The
 * tooltip says what it is.
 */
export function NamedChip({
	named,
	whole = false,
}: {
	named: Named;
	/** Whether it shows all its name, wrapping, rather than cut short. */
	whole?: boolean;
}): JSX.Element {
	const board = useContext(Board);
	const openArtifact = useOpenArtifact();
	const opener = use(OpenerContext);
	switch (named.kind) {
		case "task": {
			const { task, goal = "", note } = named;
			return (
				<Chip
					Icon={TaskIcon}
					title={`Task ${task}${goal === "" ? "" : `: ${goal}`}${note === undefined ? "" : `\n${note}`}`}
					open={
						board.linked && board.tasks.includes(task)
							? () => board.openTask(task)
							: undefined
					}
					className={GIVES_WAY}
				>
					{task}
				</Chip>
			);
		}
		case "todo": {
			const { id, subject, note } = named;
			return (
				<Chip
					Icon={ListTodoIcon}
					title={`Task #${id}: ${subject}${note === undefined ? "" : `\n${note}`}`}
					open={
						board.todos.some((todo) => todo.id === id)
							? () => board.open(id)
							: undefined
					}
					whole={whole}
					className={GIVES_WAY_FIRST}
				>
					#{id} {subject}
				</Chip>
			);
		}
		case "todos": {
			const { todos } = named;
			return (
				<Chip
					Icon={ListTodoIcon}
					title={`Tasks ${todos.map(({ id }) => `#${id}`).join(", ")}`}
					open={
						board.linked
							? () => board.openTodos(todos.map(({ id }) => id))
							: undefined
					}
					className={GIVES_WAY}
				>
					{todos.length} tasks
				</Chip>
			);
		}
		case "lane": {
			const exists = board.lanes.some((lane) => lane.id === named.id);
			return (
				<Chip
					Icon={LaneIcon}
					title={
						exists
							? `Lane ${named.id}: ${named.name}`
							: `Lane ${named.id}: ${named.name} (no longer exists)`
					}
					open={exists ? () => board.openLane(named.id) : undefined}
					missing={board.linked && !exists}
					className={GIVES_WAY}
				>
					{named.name}
				</Chip>
			);
		}
		case "branch":
			return (
				<Chip
					Icon={GitBranchIcon}
					title={`Branch ${named.branch}`}
					className={GIVES_WAY}
				>
					{named.branch}
				</Chip>
			);
		case "file":
			return (
				<Chip
					Icon={FileIcon}
					title={named.path}
					href={opener.url(named.path, null)}
					className={cn("font-mono", GIVES_WAY_FIRST)}
				>
					{distinctNames([named.path]).get(named.path)}
				</Chip>
			);
		case "artifact": {
			const { conversation, name, version } = named;
			return (
				<Chip
					Icon={FileIcon}
					title={`Artifact ${name}, version ${version}`}
					open={() => openArtifact(conversation, name, version)}
					className={cn("font-mono", GIVES_WAY_FIRST)}
				>
					{name}
				</Chip>
			);
		}
		case "command":
			return (
				<Chip
					Icon={TerminalIcon}
					title={named.command}
					className={cn("font-mono", GIVES_WAY_FIRST)}
				>
					{named.command}
				</Chip>
			);
		case "cred":
			return (
				<Chip
					Icon={KeyRoundIcon}
					title={`Cred ${named.name}`}
					href={credAddress(named.name)}
					className={cn("font-mono", GIVES_WAY)}
				>
					{named.name}
				</Chip>
			);
	}
}

/**
 * A name in a line, after its kind's icon, bordered as the page borders names
 * it can open: a link given `href`, a button given `open`, else a plain span.
 */
function Chip({
	Icon,
	title,
	open,
	href,
	whole = false,
	missing = false,
	className,
	children,
}: {
	Icon: LucideIcon;
	title: string;
	open?: (() => void) | undefined;
	href?: string;
	/** Whether it shows all its name, wrapping, rather than cut short. */
	whole?: boolean;
	/** Whether what it names is gone, so it is struck through and dimmed. */
	missing?: boolean;
	className?: string;
	children: ReactNode;
}): JSX.Element {
	const look = cn(
		"flex items-center gap-1 rounded-md border px-1.5",
		whole ? "min-h-6 max-w-full py-0.5 text-left" : "h-6 max-w-80",
		(open !== undefined || href !== undefined) &&
			"cursor-pointer hover:bg-muted",
		missing && "line-through opacity-60",
		className,
	);
	const inside = (
		<>
			<Icon aria-hidden className="size-3 shrink-0" />
			<span className={whole ? "whitespace-normal" : "min-w-0 truncate"}>
				{children}
			</span>
		</>
	);
	if (href !== undefined) {
		return (
			<a href={href} title={title} className={look}>
				{inside}
			</a>
		);
	}
	if (open !== undefined) {
		return (
			<button type="button" title={title} onClick={open} className={look}>
				{inside}
			</button>
		);
	}
	return (
		<span title={title} className={look}>
			{inside}
		</span>
	);
}

/** An event's one action, as a small button, or what it did once done. */
export function Action({ act }: { act: Act }): JSX.Element {
	const { done = null, busy = false } = act;
	const shown = useShowPending(busy);
	if (done !== null) {
		return <span className="min-w-0 truncate">{done}</span>;
	}
	return (
		<Button
			variant="outline"
			size="xs"
			disabled={busy}
			aria-busy={busy}
			aria-expanded={act.expanded}
			onClick={act.run}
			className="min-w-0 shrink"
			title={act.label}
		>
			{busy && shown && <PendingSpinner shown />}
			<span className="min-w-0 truncate">{act.label}</span>
		</Button>
	);
}

/** A plain hairline beside an event, taking what room the line leaves. */
function Rule(): JSX.Element {
	return <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />;
}

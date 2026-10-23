import {
	BookOpenIcon,
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
import { useNow } from "./hooks/use-now";
import { NamedContext } from "./mentioned";
import { NoteChip } from "./note-chip";
import { type ListedPath, NotesPopover } from "./notes-popover";
import { OpenerContext } from "./openers";

import { credAddress } from "./page-address";

import { Stamp, useStamps } from "./stamp";
import { LaneIcon, TaskIcon } from "./task-icon";

/**
 * An event of splates's in the thread: one line of a verb, the thing it names,
 * and any one action, centered between two hairlines in the small muted type
 * nothing else in the thread uses, so it reads as splates speaking without
 * pulling the eye from the turns around it. Its one color is a mark leading
 * it, when it has one: a red X for a command that failed, a green check for
 * one that landed. An early warning's mark, of a conflict or an overlap, is
 * muted like its words, since it asks nothing of the person. A live wait counts down in its action's place, and goes
 * once what it waited on came; a merge under way counts up there instead. Where the line runs out of room, the names it
 * holds give way, each cut short and whole in its title. A burst of todos it
 * names lists each beneath, whole, with no hairlines of their own.
 */
export function SplatesEvent({
	event,
}: {
	event: SplatesEventView;
}): JSX.Element | null {
	const { deadline = null, since = null } = event;
	const live = deadline !== null && !deadline.met;
	const now = useNow(live || since !== null);
	if (deadline?.met) {
		return null;
	}
	const left = live
		? Math.max(0, Date.parse(deadline.until) - now)
		: since !== null
			? Math.max(0, now - Date.parse(since))
			: null;
	const listed = event.words.flatMap((word) =>
		typeof word !== "string" && word.kind === "todos" ? word.todos : [],
	);
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
				<Line event={event} left={left} />
				<Rule />
			</div>
			{listed.length > 0 && (
				<ul className="mt-2 flex flex-col items-center gap-2">
					{listed.map(({ id, subject, note }) => (
						<li key={id} className="flex max-w-full">
							<NamedChip named={{ kind: "todo", id, subject, note }} whole />
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * Something an event names, drawn as a chip with its kind's icon that opens it
 * where it can. `todos` names a burst of them, such as a groom's, as one
 * chip, "5 todos", listing each beneath the line.
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
	| { kind: "command"; command: string }
	/** A project note, by its path from the project root. */
	| { kind: "note"; path: string }
	/** Project notes, by their paths from the project root, as one pill. */
	| { kind: "notes"; notes: readonly ListedPath[] };

/**
 * What an event says, read in order: a verb and the thing it names, each
 * named once, so it fits one line: `["Merged", task]`. What cannot be said
 * so is not an event line.
 */
export type Words = readonly (string | Named)[];

/**
 * One thing splates did in a conversation, as its own voice in the thread
 * rather than the person's or the agent's: what it did and what it names,
 * then when.
 */
export interface SplatesEventView {
	/** The mark leading it, its line's only color, when it has one. */
	mark?: Mark | null;
	/** What it did, as a verb and its subject: `["Merged", task]`. */
	words: Words;
	/**
	 * When, as an ISO time, to place it among the thread's messages; shown at
	 * the line's end while the conversation's stamps are on. Null for one with
	 * no time to show.
	 */
	at?: string | null;
	/** What the line stands for, in full, on hover: a directive's text. */
	title?: string;
	/** A wait it counts down in its action's place, when it has one. */
	deadline?: Deadline | null;
	/** When what it says began, as an ISO time, for a line counting up from it while it runs. */
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
 * A wait an event counts down to `until`. Once what it waited on comes, it is
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
}

/**
 * One event's line: its mark, if any, its words, then its one action, or in
 * its place the time its wait has left.
 */
function Line({
	event,
	left,
}: {
	event: SplatesEventView;
	/** How long its deadline has left, or since it began, in ms, while it counts; else null. */
	left: number | null;
}): JSX.Element {
	const { mark = null, act = null } = event;
	const stamped = useStamps().shown;
	return (
		<p
			title={event.title}
			className="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap"
		>
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
			<Words words={event.words} />
			{stamped && event.at != null && <Stamp at={event.at} />}
			{left !== null ? (
				<span className="shrink-0 tabular-nums">{countdown(left)}</span>
			) : (
				act !== null && <Action act={act} />
			)}
		</p>
	);
}

/** Plain descriptions wrap; names between short words give way where room runs out. */
function Words({ words }: { words: Words }): ReactNode {
	if (words.length === 1 && typeof words[0] === "string") {
		return (
			<span className="min-w-0 whitespace-normal wrap-anywhere text-center">
				{words[0]}
			</span>
		);
	}
	return words.map((word, index) =>
		typeof word === "string" ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: words never move
			<span key={index} className="shrink-0">
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
	const { notesRoot, tree } = use(NamedContext);
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
		case "note": {
			const root = notesRoot ?? tree;
			return root === null ? (
				<Chip Icon={BookOpenIcon} title={named.path} className={GIVES_WAY}>
					{named.path.split("/").at(-1)}
				</Chip>
			) : (
				<span className={cn("min-w-0", GIVES_WAY)}>
					<NoteChip path={`${root}/${named.path}`} />
				</span>
			);
		}
		case "notes":
			return (
				<span className={cn("min-w-0", GIVES_WAY)}>
					<NotesPopover title="Read this turn" notes={named.notes} />
				</span>
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

function Action({ act }: { act: Act }): JSX.Element {
	const { done = null } = act;
	if (done !== null) {
		return <span className="shrink-0">{done}</span>;
	}
	return (
		<Button variant="outline" size="xs" onClick={act.run} className="shrink-0">
			{act.label}
		</Button>
	);
}

/** A plain hairline beside an event, taking what room the line leaves. */
function Rule(): JSX.Element {
	return <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />;
}

/** `ms` as `M:SS`: `9:00`, `12:30`. */
function countdown(ms: number): string {
	const secs = Math.ceil(ms / 1000);
	return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

import {
	type AppendMessage,
	type AssistantRuntime,
	AssistantRuntimeProvider,
	SimpleImageAttachmentAdapter,
	type ThreadMessageLike,
	type TriggerAdapter,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	BookmarkCheckIcon,
	CheckIcon,
	ChevronDownIcon,
	EllipsisVerticalIcon,
	FileDiffIcon,
	LinkIcon,
	Loader2Icon,
	PencilIcon,
	PlusIcon,
	SendHorizontalIcon,
	SquareArrowOutUpRightIcon,
	SquareTerminalIcon,
	Trash2Icon,
} from "lucide-react";
import {
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { PermissionGrant } from "#dev/components/assistant-ui/elements/permission-grant.tsx";
import { QuestionFlow } from "#dev/components/assistant-ui/elements/question-flow.tsx";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Badge } from "#dev/components/ui/badge.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#dev/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#dev/components/ui/select.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Ending, stretches } from "../asked";
import type {
	Answer,
	Ask,
	Checkpoint,
	ConversationState,
	Image,
	Message,
	Setting,
	Status,
} from "../conversations";
import type { LaneRecord } from "../lanes";
import { type Need, type Needing, need, needs } from "../needs";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { AgentBrand, AgentIcon } from "./agent-icons";
import {
	answerConversation,
	archiveConversation,
	cancelConversation,
	checkpointConversations,
	chooseSetting,
	conversationImage,
	dismissCheckpoint,
	paths,
	promptConversation,
	renameConversation,
	sendQueuedNow,
	startConversation,
	unqueueConversation,
} from "./api";
import { Back } from "./back";
import { copiedLabel, useCopy } from "./card";
import { TONES } from "./card-shell";
import { ReviewChanges } from "./changes";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { Drafts, newDraft } from "./drafts";
import { rank } from "./mentions";
import { useNotifier } from "./notifications";
import { type Action, Overview, OverviewButtons } from "./overview";
import {
	QuestionsUI,
	type Reply,
	ReplyContext,
	ReviewUI,
} from "./question-cards";
import { CheckpointState } from "./release";
import {
	ArchiveContext,
	ENDINGS,
	ReportUI,
	StartNewContext,
	TodosContext,
	TodoUI,
} from "./report-cards";
import type { Settings } from "./settings";
import { TASK, TaskLine, TaskView } from "./task-view";
import { Task } from "./tasks";
import { ShellRunning, ToggleTerminal } from "./terminal";
import { TOGGLE } from "./terminal-session";
import type { Work } from "./work";
import { WorkUI } from "./work-row";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";
/**
 * In place of an id in the address: the screen that starts a conversation,
 * with the agent after it, as `new/codex`, else the agent last used.
 */
export const NEW = "new";

/** Whether `open` is the screen that starts a conversation, with any agent. */
function startsOne(open: string | null): boolean {
	return open === NEW || (open?.startsWith(`${NEW}/`) ?? false);
}

/**
 * The agent a new conversation starts with: the one `open` names, else the
 * newest conversation's, else the first.
 */
function agentFor(
	open: string | null,
	agents: AgentChoice[],
	conversations: ConversationState[],
): string {
	const named = open?.startsWith(`${NEW}/`) ? open.slice(NEW.length + 1) : null;
	return (
		agents.find((each) => each.id === named)?.id ??
		agents.find((each) => each.id === conversations[0]?.agent)?.id ??
		agents[0]?.id ??
		""
	);
}

/**
 * The conversation a `#conversations/<id>` address names, `ARCHIVED` for the
 * archived ones, or null.
 */
export function conversationIn(hash: string): string | null {
	const [, id] = hash.match(/^#conversations\/(.+)$/) ?? [];
	return id ?? null;
}

/**
 * Where a conversation runs, for a list not grouped by task: nothing when its
 * name already says so.
 */
function whereOf(conversation: ConversationState): string | null {
	if (conversation.task === null) {
		return "main tree";
	}
	return nameOf(conversation) === conversation.task ? null : conversation.task;
}

/**
 * What a conversation goes by: the name the person gave it, else the task its
 * agent holds, so it follows the agent from task to task, else the agent's
 * title. Until it has one, a stand-in (see `unnamed`): the first line of what
 * the person first said, else "Not started".
 */
function nameOf(conversation: ConversationState): string {
	return (
		conversation.name ??
		conversation.task ??
		conversation.title ??
		openingOf(conversation) ??
		"Not started"
	);
}

/** Whether `nameOf` is a stand-in, shown muted until a real name comes. */
function unnamed(conversation: ConversationState): boolean {
	return (
		conversation.name === null &&
		conversation.task === null &&
		conversation.title === null
	);
}

/** The first line the person said in a conversation, or null before they say any. */
function openingOf(conversation: ConversationState): string | null {
	for (const message of conversation.messages) {
		if (message.role !== "user") {
			continue;
		}
		for (const part of message.parts) {
			const line = part.type === "text" ? part.text.trim().split("\n")[0] : "";
			if (line) {
				return line;
			}
		}
	}
	return null;
}

/** Whether a conversation has an agent running, which a checkpoint asks. */
function live({ status }: ConversationState): boolean {
	return status === "starting" || status === "idle" || status === "running";
}

/**
 * Asks every live conversation here to bring its ARBOR.md up to date and
 * stop, whenever the person likes, and opens on how each gets on. A click
 * while one is under way only opens it; the next starts once every agent has
 * answered or run out of time, or the person dismisses it. Shown while one is
 * live, or one has been asked.
 */
function CheckpointAll({
	conversations,
	onOpen,
}: {
	conversations: ConversationState[];
	onOpen: (id: string) => void;
}): JSX.Element | null {
	const [open, setOpen] = useState(false);
	const asked = conversations.filter((each) => each.checkpoint !== null);
	if (!conversations.some(live) && asked.length === 0) {
		return null;
	}
	const count = (checkpoint: Checkpoint) =>
		asked.filter((each) => each.checkpoint === checkpoint).length;
	const done = count("done");
	const going = count("asked");
	const missed = asked.filter(
		(each) => each.checkpoint === "failed" || each.checkpoint === "unanswered",
	);
	const says =
		going > 0
			? `Checkpointing ${asked.length - going} of ${asked.length}`
			: asked.length === 0
				? "Checkpoint all"
				: missed.length === 0
					? `Checkpointed ${done}`
					: `Checkpointed ${done}, ${missed.length} not`;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						data-row
						title={
							missed.length > 0
								? `Not checkpointed: ${missed.map(nameOf).join(", ")}`
								: "Ask every live agent to bring its ARBOR.md up to date and stop"
						}
						className={cn(
							"flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted",
							missed.length > 0 && going === 0 && "text-destructive",
						)}
					/>
				}
				onClick={() => {
					// One under way stands: the click only shows it.
					if (going === 0) {
						checkpointConversations().catch((error: unknown) =>
							refused("Not checkpointed", error),
						);
					}
				}}
			>
				{going > 0 ? (
					<Loader2Icon className="size-3.5 animate-spin" />
				) : asked.length > 0 && missed.length === 0 ? (
					<CheckIcon className="size-3.5 text-success" />
				) : (
					<BookmarkCheckIcon className="size-3.5" />
				)}
				<span className="flex-1">{says}</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72">
				<PopoverHeader>
					<PopoverTitle>Checkpoint</PopoverTitle>
					<PopoverDescription>
						Each agent brings its ARBOR.md up to date and stops.
					</PopoverDescription>
				</PopoverHeader>
				{asked.length === 0 ? (
					<span className="text-muted-foreground text-xs">Asking…</span>
				) : (
					<ul className="flex flex-col">
						{asked.map((each) => (
							<li key={each.id}>
								<button
									type="button"
									onClick={() => {
										setOpen(false);
										onOpen(each.id);
									}}
									className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
								>
									<span className="min-w-0 flex-1 truncate">
										{nameOf(each)}
									</span>
									{each.checkpoint !== null && (
										<CheckpointState checkpoint={each.checkpoint} />
									)}
								</button>
							</li>
						))}
					</ul>
				)}
				<Button
					size="xs"
					variant="outline"
					className="self-end"
					onClick={() =>
						dismissCheckpoint().then(
							() => setOpen(false),
							(error: unknown) => refused("Not dismissed", error),
						)
					}
				>
					Dismiss
				</Button>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The sidebar's conversations, under New conversation, in one list, newest
 * first, each row named alone, with its task on hover. A conversation follows its agent
 * as it takes and lands tasks. A task whose agent runs outside the page is a
 * row of its own. Rows stay put as their agents change state; each one's mark
 * says whether it works or waits on you. Archived ones sit behind a link at
 * the bottom.
 *
 * The arrow keys move between rows, Alt+N opens the next one waiting, and
 * ⌥⌘N (Ctrl+Alt+N off a Mac) starts a new one as the last was started.
 * As `settings` say, it notifies of an agent that comes to wait on you,
 * finishes its turn, or goes quiet.
 */
export function ConversationList({
	feed,
	tasks,
	settings,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	/** What to notify of, or null for a list that notifies of nothing. */
	settings: Settings | null;
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { agents, conversations } = useReactive(
		feed,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	const listed = conversations.filter((each) => !each.archived);
	const external = needs({ tasks, conversations }).filter(
		(each) => each.conversation === null,
	);
	const rows: Needing[] = [
		...listed.map((conversation) => ({
			conversation,
			task: null,
			need: needOf(tasks, conversation),
		})),
		...external,
	].toSorted((one, other) => started(other).localeCompare(started(one)));
	const archived = conversations.length - listed.length;
	const openRow = (row: Needing) => {
		if (row.conversation !== null) {
			onOpen(row.conversation.id);
		} else if (row.task !== null) {
			onOpen(`${TASK}${row.task.task}`);
		}
	};
	useNotifier(
		settings,
		rows,
		(row) =>
			(row.conversation ? nameOf(row.conversation) : row.task?.task) ?? "",
		openRow,
	);
	// The latest, for the listener below, which outlives a render.
	const onOpenRef = useRef(onOpen);
	onOpenRef.current = onOpen;
	const next = useRef(() => {});
	next.current = () => {
		const at = rows.findIndex(
			(row) =>
				(row.conversation !== null && row.conversation.id === open) ||
				(row.task !== null && `${TASK}${row.task.task}` === open),
		);
		// After the one open, around to the top.
		const after = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
		const waiting = after.find((row) => row.need.kind === "waiting");
		if (waiting !== undefined) {
			openRow(waiting);
		}
	};
	useEffect(() => {
		const jump = (event: KeyboardEvent) => {
			// By the key's place, since Alt+N types a tilde on a Mac.
			if (!event.altKey || event.code !== "KeyN") {
				return;
			}
			event.preventDefault();
			if (event.metaKey || event.ctrlKey) {
				// With the agent, model, and settings the last one started with.
				onOpenRef.current(NEW);
			} else {
				next.current();
			}
		};
		document.addEventListener("keydown", jump);
		return () => document.removeEventListener("keydown", jump);
	}, []);

	return (
		<nav
			aria-label="conversations"
			className="flex flex-col gap-3"
			onKeyDown={(event) => {
				const step =
					event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
				if (step === 0) {
					return;
				}
				const all = [
					...event.currentTarget.querySelectorAll<HTMLElement>("[data-row]"),
				];
				const at = all.indexOf(event.target as HTMLElement);
				const target = all[at + step];
				// Not from a dialog the list opened, whose keys bubble here too.
				if (at !== -1 && target !== undefined) {
					event.preventDefault();
					target.focus();
				}
			}}
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							data-row
							aria-current={startsOne(open) ? "page" : undefined}
							className={cn(
								"flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-foreground/[0.05]",
								startsOne(open) && "bg-accent",
							)}
						/>
					}
				>
					<PlusIcon className="size-3.5" />
					<span className="flex-1">New conversation</span>
					<ChevronDownIcon className="size-3.5 text-muted-foreground" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="start" className="w-44">
					{agents.map((each) => (
						<DropdownMenuItem
							key={each.id}
							onClick={() => onOpen(`${NEW}/${each.id}`)}
						>
							<AgentIcon agent={each.id} name={each.name} />
							{each.name}
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
			<CheckpointAll conversations={listed} onOpen={onOpen} />
			<ul aria-label="conversation list" className="flex flex-col">
				{rows.map((row) =>
					row.conversation !== null ? (
						<li key={row.conversation.id}>
							<Item
								conversation={row.conversation}
								agent={agentName(agents, row.conversation.agent)}
								need={row.need}
								current={row.conversation.id === open}
								onOpen={() => openRow(row)}
							/>
						</li>
					) : (
						row.task !== null && (
							<li key={`external ${row.task.task}`}>
								<External
									task={row.task}
									need={row.need}
									current={`${TASK}${row.task.task}` === open}
									onOpen={() => openRow(row)}
								/>
							</li>
						)
					),
				)}
			</ul>
			<button
				type="button"
				data-row
				aria-current={open === ARCHIVED ? "page" : undefined}
				onClick={() => onOpen(ARCHIVED)}
				className={cn(
					"flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-muted-foreground text-xs hover:bg-muted",
					open === ARCHIVED && "bg-muted text-foreground",
				)}
			>
				<ArchiveIcon className="size-3.5" />
				<span className="flex-1">Archived</span>
				<span className="tabular-nums">{archived}</span>
			</button>
		</nav>
	);
}

/**
 * How many agents wait on the person: conversations, and tasks whose agents
 * run outside the page.
 */
export function useWaiting(feed: ConversationFeed, tasks: Details[]): number {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	return needs({ tasks, conversations }).filter(
		(each) => each.need.kind === "waiting",
	).length;
}

/** When a row's conversation or task began; a task from before that, never. */
function started(row: Needing): string {
	return row.conversation?.createdAt ?? row.task?.createdAt ?? "";
}

/** What a conversation needs, from the task it runs in, if any. */
function needOf(tasks: Details[], conversation: ConversationState): Need {
	const task =
		conversation.task === null
			? null
			: (tasks.find((each) => each.task === conversation.task) ?? null);
	return need(task, conversation);
}

/**
 * A task whose agent runs outside the page, such as in Claude Code or Codex,
 * as a peer of a conversation: named for its task, and opening it alone.
 */
function External({
	task,
	need,
	current,
	onOpen,
}: {
	task: Details;
	need: Need;
	current: boolean;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-row
			aria-current={current ? "page" : undefined}
			onClick={onOpen}
			className={cn(
				"flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<SquareArrowOutUpRightIcon
				role="img"
				aria-label="external agent"
				className="size-3.5 text-foreground/70"
			/>
			<span className="min-w-0 flex-1 truncate text-sm">{task.task}</span>
			<span className="shrink-0 text-muted-foreground text-xs">external</span>
			<Mark need={need} />
		</button>
	);
}

/**
 * One conversation in a list: its agent's mark, its name, and whether it
 * needs you. Hovered or focused, it offers Archive (or Unarchive) and a menu.
 */
function Item({
	conversation,
	agent,
	need,
	current,
	onOpen,
	where = false,
}: {
	conversation: ConversationState;
	agent: string;
	need: Need;
	current: boolean;
	onOpen: () => void;
	/** Whether to say where it ran, rather than only on hover. */
	where?: boolean;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const { copied, copy } = useCopy();
	const { id, archived } = conversation;
	const { file, confirm } = useArchive(conversation);
	const reported = reportedAs(conversation);
	const Put = archived ? ArchiveRestoreIcon : ArchiveIcon;
	const put = archived ? "Unarchive" : "Archive";
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			{renaming && (
				<Rename conversation={conversation} onDone={() => setRenaming(false)} />
			)}
			{confirm}
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				onDoubleClick={() => setRenaming(true)}
				title={where ? undefined : (conversation.task ?? undefined)}
				// Room for the buttons only while they show, and for a mark while
				// there is one.
				className={cn(
					// A touch screen has no hover, so its buttons always show.
					"flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left group-focus-within/item:pr-14 group-hover/item:pr-14 pointer-coarse:pr-24",
					renaming && "hidden",
					menu
						? "pr-14"
						: need.kind === "idle" && reported === null
							? "pr-3"
							: "pr-6",
				)}
			>
				<AgentIcon
					agent={conversation.agent}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm",
						unnamed(conversation) && "text-muted-foreground italic",
					)}
				>
					{nameOf(conversation)}
				</span>
				{where && whereOf(conversation) !== null && (
					<span className="shrink-0 truncate text-muted-foreground text-xs">
						{whereOf(conversation)}
					</span>
				)}
			</button>
			<span
				className={cn(
					"pointer-events-none absolute right-2 flex items-center pointer-coarse:right-16",
					renaming && "hidden",
					menu
						? "hidden"
						: "group-focus-within/item:hidden group-hover/item:hidden",
				)}
			>
				<Mark need={need} reported={reported} />
			</span>
			<span
				className={cn(
					"absolute right-1 flex items-center",
					renaming && "hidden",
					!menu &&
						"opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100",
				)}
			>
				<DropdownMenu open={menu} onOpenChange={setMenu}>
					<DropdownMenuTrigger
						render={
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`More for ${nameOf(conversation)}`}
							/>
						}
					>
						<EllipsisVerticalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-44">
						<DropdownMenuItem
							closeOnClick={false}
							title={copied.state === "failed" ? copied.error : undefined}
							onClick={() =>
								copy(
									`${location.origin}${location.pathname}#conversations/${id}`,
								)
							}
						>
							{copied.state === "copied" ? <CheckIcon /> : <LinkIcon />}
							<span aria-live="polite">{copiedLabel(copied, "Copy link")}</span>
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setRenaming(true)}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem onClick={file}>
							<Put />
							{put}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`${put} ${nameOf(conversation)}`}
					onClick={file}
				>
					<Put />
				</Button>
			</span>
		</div>
	);
}

/**
 * Archives `conversation`, or brings it back. While its agent works, or sits
 * idle with its shell up, `file` asks first in `confirm`, since archiving
 * stops both; render `confirm` beside whatever calls `file`.
 */
function useArchive(conversation: ConversationState): {
	file: () => void;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState(false);
	const shellRunning = useContext(ShellRunning);
	const { id, archived } = conversation;
	const put = () =>
		void archiveConversation(id, !archived).catch((error: unknown) =>
			refused(archived ? "Not unarchived" : "Not archived", error),
		);
	const working =
		conversation.status === "starting" || conversation.status === "running";
	// Idle, only its shell can lose anything, like a dev server it runs; asked
	// as it is clicked, since the shell comes and goes without a render here.
	const file = () =>
		!archived &&
		(working || (conversation.status === "idle" && shellRunning(id)))
			? setAsking(true)
			: put();
	const confirm = (
		<Dialog open={asking} onOpenChange={setAsking}>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Archive {nameOf(conversation)}?</DialogTitle>
					<DialogDescription>
						{working
							? "The agent is still running. Archiving stops it and closes its terminal."
							: "Its terminal is still open. Archiving closes it, and stops the idle agent."}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Cancel
					</DialogClose>
					<Button
						variant="destructive"
						onClick={() => {
							setAsking(false);
							put();
						}}
					>
						Archive
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
	return { file, confirm };
}

/**
 * A box in place of a conversation's name: Enter keeps what is typed (blank
 * goes back to the agent's title), and Escape or leaving it keeps the old.
 */
function Rename({
	conversation,
	onDone,
}: {
	conversation: ConversationState;
	onDone: () => void;
}): JSX.Element {
	// "Not started" is no name to edit from.
	const [value, setValue] = useState(
		unnamed(conversation)
			? (openingOf(conversation) ?? "")
			: nameOf(conversation),
	);
	const box = useRef<HTMLInputElement>(null);
	useEffect(() => {
		// After the menu that asked for it hands focus back to its trigger.
		const later = setTimeout(() => box.current?.select());
		return () => clearTimeout(later);
	}, []);
	return (
		<input
			ref={box}
			aria-label={`Rename ${nameOf(conversation)}`}
			value={value}
			onChange={(event) => setValue(event.target.value)}
			onBlur={onDone}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					renameConversation(conversation.id, value)
						.catch((error: unknown) => refused("Not renamed", error))
						.finally(onDone);
				} else if (event.key === "Escape") {
					event.preventDefault();
					onDone();
				}
			}}
			className="mx-1 h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		/>
	);
}

/**
 * What a list shows of an agent: a pulsing dot when it waits on you, a spinner while
 * it works, assuming or not, and an empty space when idle. When its last word
 * is a report of how its task ended or that it escalated, that report card's
 * icon stands in for the dot or the space, though not for a live ask or a
 * failure, which are newer. What it waits on is in its tooltip. Each sits
 * centered in a box of one size, so marks line up down a list whichever kind
 * they are.
 */
function Mark({
	need,
	reported = null,
}: {
	need: Need;
	reported?: Ending | null;
}): JSX.Element {
	const shows =
		need.kind === "idle" ||
		(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed");
	if (reported !== null && shows) {
		const { title, Icon, tone } = ENDINGS[reported];
		return (
			<Icon
				role="img"
				aria-label={title.toLowerCase()}
				className={cn("size-3.5 shrink-0", TONES[tone].icon)}
			/>
		);
	}
	if (need.kind === "idle") {
		// Empty, so what sits beside it lines up with the rows that have one.
		return <span className="size-3.5 shrink-0" />;
	}
	const waiting = need.kind === "waiting";
	return (
		<span
			role="status"
			aria-label={waiting ? "waiting on you" : "working"}
			title={waiting ? need.subject : undefined}
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			{waiting ? (
				<span className="size-2 animate-pulse rounded-full bg-sky-500" />
			) : (
				<Loader2Icon className="size-3.5 animate-spin text-foreground/60" />
			)}
		</span>
	);
}

/**
 * How the task ended, or that it escalated, when the conversation's last word
 * is the agent's report saying so. Anything the person says after it carries
 * the conversation on, and the report goes.
 */
function reportedAs(conversation: ConversationState): Ending | null {
	const last = conversation.messages.at(-1);
	if (last === undefined || last.role !== "agent") {
		return null;
	}
	const reply = last.parts.findLast(
		(part) => part.type === "text" && part.text.trim() !== "",
	);
	const report =
		reply?.type === "text"
			? stretches(reply.text).findLast((each) => each.type === "report")
			: undefined;
	return report?.type === "report" ? report.report.ending : null;
}

function agentName(agents: AgentChoice[], id: string): string {
	return agents.find((agent) => agent.id === id)?.name ?? id;
}

/**
 * The open conversation, or the archived ones when `open` is `ARCHIVED`. On a
 * phone, where there is no sidebar, it is one or the other: the list until a
 * conversation is opened, then that alone, with a way back.
 */
export function Conversations({
	feed,
	tasks,
	todos,
	lanes,
	trunk,
	open,
	onOpen,
	phone,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	/** What a todo an agent proposes is read from, live. */
	todos: TodoState[];
	lanes: LaneRecord[];
	/** The main tree's branch. */
	trunk: string;
	open: string | null;
	onOpen: (id: string | null) => void;
	/** Whether there is no sidebar to hold the list. */
	phone: boolean;
}): JSX.Element {
	const { agents, conversations } = useReactive(
		feed,
		(feed) => ({ agents: feed.agents, conversations: feed.conversations }),
		["changed"],
	);
	const shown = conversations.find((each) => each.id === open) ?? null;
	const external = tasks.find((each) => `${TASK}${each.task}` === open) ?? null;
	// One for the page, so a draft Home leaves for a conversation it started
	// reaches that conversation's composer.
	const [drafts] = useState(() => new Drafts(localStorage));
	const board = useMemo(() => ({ todos, lanes }), [todos, lanes]);

	return (
		<TodosContext value={board}>
			<div className="flex flex-col gap-4">
				{phone && open === null ? (
					<ConversationList
						feed={feed}
						tasks={tasks}
						// A phone's browser notifies only from a service worker, and
						// this list comes and goes with what is open.
						settings={null}
						open={open}
						onOpen={onOpen}
					/>
				) : startsOne(open) || (open === null && !phone) ? (
					<Home
						// Its picks are for one agent's settings, so start over for another.
						key={agentFor(open, agents, conversations)}
						drafts={drafts}
						tasks={tasks}
						feed={feed}
						agents={agents}
						agent={agentFor(open, agents, conversations)}
						conversations={conversations}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				) : open === ARCHIVED ? (
					<Archived
						tasks={tasks}
						conversations={conversations.filter((each) => each.archived)}
						agents={agents}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				) : open?.startsWith(TASK) ? (
					external === null ? (
						<p className="text-muted-foreground text-sm">No such task.</p>
					) : (
						<TaskView
							task={external}
							need={need(external, null)}
							onBack={phone ? () => onOpen(null) : null}
						/>
					)
				) : shown === null ? (
					<p className="text-muted-foreground text-sm">No such conversation.</p>
				) : (
					<Thread
						key={shown.id}
						drafts={drafts}
						conversation={shown}
						feed={feed}
						agent={agentName(agents, shown.agent)}
						task={tasks.find((each) => each.task === shown.task) ?? null}
						trunk={trunk}
						onArchived={() => onOpen(NEW)}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				)}
			</div>
		</TodosContext>
	);
}

/** How many conversations the home screen offers to pick back up. */
const RECENT = 5;

/**
 * The screen with no conversation open: an empty thread whose first message
 * starts one with `agent` in the main tree, the agent's settings in its
 * composer, and under the greeting the latest conversations to pick back up,
 * those waiting on the person first.
 */
function Home({
	drafts,
	tasks,
	feed,
	agents,
	agent,
	conversations,
	onOpen,
	onBack,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	tasks: Details[];
	feed: ConversationFeed;
	agents: AgentChoice[];
	/** The agent the conversation starts with, picked beside New conversation. */
	agent: string;
	/** Every one, archived too, newest first. */
	conversations: ConversationState[];
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	// What the agent's sessions offer is known from its latest conversation
	// that got as far as a session, archived or not, and each setting starts
	// where that one left it; the first one with an agent starts with the
	// agent's own defaults.
	const offered =
		conversations.find(
			(each) => each.agent === agent && each.settings.length > 0,
		)?.settings ?? [];
	const [picks, setPicks] = useState<Record<string, string>>(() =>
		Object.fromEntries(offered.map((each) => [each.id, each.current])),
	);
	const listed = conversations.filter((each) => !each.archived);
	const [starting, setStarting] = useState(false);
	const restore = useRef<(text: string, images: File[]) => void>(() => {});
	// Only those at rest: one at work or waiting on the person is in the
	// sidebar already, and is not one to pick back up.
	const recent = listed
		.filter((each) => needOf(tasks, each).kind === "idle")
		.slice(0, RECENT);
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		isRunning: starting,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters: { attachments: IMAGES },
		onNew: async (message) => {
			const text = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			const images = imagesOf(message);
			setStarting(true);
			const state = await startConversation(agent, null, picks).catch(
				(error: unknown) => {
					setStarting(false);
					restore.current(text, images);
					refused("Not started", error);
					throw error;
				},
			);
			feed.put(state);
			// Shown at once, its words in its thread, so the person watches the
			// agent come up; the message waits on the server for the session to
			// open.
			if (text !== "") {
				feed.send(state.id, text);
			}
			onOpen(state.id);
			await promptConversation(state.id, text, images).catch(
				(error: unknown) => {
					// The conversation is open by now: what was not sent waits in its
					// composer, its words only.
					feed.sent(state.id);
					drafts.write(state.id, text);
					refused("Not sent", error);
				},
			);
		},
	});
	restore.current = useDraft(
		runtime,
		drafts,
		newDraft(new URLSearchParams(location.search).get("project")),
	);
	const mentions = useFileMentions(null);

	return (
		<section
			aria-label="new conversation"
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			{onBack !== null ? (
				<header className="flex min-h-9 items-center gap-2">
					<Back onBack={onBack} />
					<h2 className="font-medium text-sm">New conversation</h2>
				</header>
			) : (
				// A conversation's header's room, so the welcome sits where theirs do.
				<div aria-hidden className="h-9 shrink-0" />
			)}
			<AssistantRuntimeProvider runtime={runtime}>
				<ThreadView
					mentions={mentions ?? undefined}
					welcome={
						<div className="mb-6 flex flex-col gap-8 px-2">
							<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-2xl tracking-tight duration-200">
								<span>Start a conversation with</span>
								<AgentBrand agent={agent} name={agentName(agents, agent)} />
							</div>
							{recent.length > 0 && (
								<section
									aria-label="recent conversations"
									className="flex flex-col gap-1"
								>
									<h3 className="pl-3 font-medium text-muted-foreground text-xs">
										Pick back up
									</h3>
									<ul className="flex flex-col">
										{recent.map((each) => (
											<li key={each.id}>
												<Recent
													conversation={each}
													agent={agentName(agents, each.agent)}
													onOpen={() => onOpen(each.id)}
												/>
											</li>
										))}
									</ul>
								</section>
							)}
						</div>
					}
					controls={offered.map((setting) => (
						<SettingControl
							key={setting.id}
							setting={setting}
							value={picks[setting.id] ?? setting.current}
							onChange={(value) =>
								setPicks((picks) => ({ ...picks, [setting.id]: value }))
							}
						/>
					))}
				/>
			</AssistantRuntimeProvider>
		</section>
	);
}

const NO_MESSAGES: ThreadMessageLike[] = [];

/**
 * A picker in the composer's bottom row: quiet until hovered, as in Zed, and
 * small, so the row holds them all on one line.
 */
const IN_COMPOSER =
	"h-6 min-w-0 shrink gap-0.5 border-transparent bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none hover:bg-muted hover:text-foreground dark:bg-transparent dark:hover:bg-muted [&_svg:not([class*='size-'])]:size-3";

/** One of a session's settings: a switch for a toggle, else a picker. */
function SettingControl({
	setting,
	value,
	onChange,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
}): JSX.Element {
	const id = useId();
	if (setting.type === "boolean") {
		return (
			<span
				title={setting.name}
				className={cn(
					IN_COMPOSER,
					"inline-flex items-center gap-1.5 rounded-md",
				)}
			>
				<label htmlFor={id} className="cursor-pointer">
					{setting.name}
				</label>
				<Switch
					id={id}
					size="sm"
					checked={value === "on"}
					onCheckedChange={(checked) => onChange(checked ? "on" : "off")}
				/>
			</span>
		);
	}
	return <SettingSelect setting={setting} value={value} onChange={onChange} />;
}

/** One of a session's settings, picked from what the agent offers. */
function SettingSelect({
	setting,
	value,
	onChange,
}: {
	setting: Setting;
	value: string;
	onChange: (value: string) => void;
}): JSX.Element {
	const known = setting.options.some((option) => option.value === value);
	return (
		<Select
			// Base UI keeps a picker's items once it has them, and shows a
			// value it cannot find as its text, "null" among them: a picker
			// reused for another agent's options must start over.
			key={setting.options.map((option) => option.value).join("\n")}
			items={setting.options.map((option) => ({
				value: option.value,
				label: option.name,
			}))}
			value={known ? value : setting.current}
			onValueChange={(value) => {
				if (value !== null) {
					onChange(String(value));
				}
			}}
		>
			<SelectTrigger
				size="sm"
				aria-label={setting.name.toLowerCase()}
				title={setting.name}
				className={IN_COMPOSER}
			>
				{/* A mode or model says what it is by its value; "Off" or "High"
				    alone would not. */}
				{setting.category !== "mode" && setting.category !== "model" && (
					<span className="text-muted-foreground/70">{setting.name}</span>
				)}
				<SelectValue />
			</SelectTrigger>
			<SelectContent
				side="top"
				align="start"
				alignItemWithTrigger={false}
				className="w-auto"
			>
				{setting.options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						title={option.description ?? undefined}
					>
						{option.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** A conversation to pick back up: its agent, name, and where it runs. */
function Recent({
	conversation,
	agent,
	onOpen,
}: {
	conversation: ConversationState;
	agent: string;
	onOpen: () => void;
}): JSX.Element {
	const reported = reportedAs(conversation);
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3 text-left text-foreground hover:bg-foreground/[0.05]"
		>
			<AgentIcon
				agent={conversation.agent}
				name={agent}
				className="size-3.5 text-foreground/70"
			/>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-sm",
					unnamed(conversation) && "text-muted-foreground italic",
				)}
			>
				{nameOf(conversation)}
			</span>
			{whereOf(conversation) !== null && (
				<span className="shrink-0 truncate text-muted-foreground text-xs">
					{whereOf(conversation)}
				</span>
			)}
			{reported !== null && (
				<Mark need={{ kind: "idle" }} reported={reported} />
			)}
		</button>
	);
}

/**
 * What the person said while the agent worked, to an agent that cannot take
 * it mid-turn, until the turn ends and it goes out: each one can be taken
 * back to edit or thrown away, and all of them sent now, which stops the turn.
 */
function Queued({
	conversation,
	messages,
	onEdit,
	onDiscard,
	onSendNow,
}: {
	conversation: string;
	messages: Message[];
	onEdit: (index: number) => void;
	onDiscard: (index: number) => void;
	onSendNow: () => void;
}): JSX.Element {
	// Enter sends the queue only with nothing typed; otherwise it queues what is.
	const empty = useAuiState((state) => state.composer.isEmpty);
	return (
		<section
			aria-label="queued messages"
			className="mb-2 flex flex-col gap-1 rounded-2xl border bg-muted/50 p-2"
		>
			<header className="flex items-center gap-2 pl-2">
				<h3 className="flex-1 text-muted-foreground text-xs">
					Queued for when the agent's turn ends
				</h3>
				<Button size="xs" variant="outline" onClick={onSendNow}>
					<SendHorizontalIcon />
					Send now
					{empty && <Kbd className="-mr-1 h-4 bg-transparent">↵</Kbd>}
				</Button>
			</header>
			<ul className="flex flex-col">
				{messages.map((message, index) => {
					const text = message.parts
						.map((part) => (part.type === "text" ? part.text : ""))
						.join("");
					const images = message.parts.flatMap((part) =>
						part.type === "image" ? [part] : [],
					);
					const label =
						text ||
						(images.length === 1 ? "an image" : `${images.length} images`);
					return (
						<li
							// Only ever added at the end and taken from anywhere, but
							// each one's words are what the person sees.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={index}
							className="group/queued flex items-center gap-2 rounded-lg py-1 pr-1 pl-2 hover:bg-foreground/[0.04]"
						>
							{images.map((image) => (
								<img
									key={image.name}
									src={conversationImage(conversation, image)}
									alt=""
									className="size-6 shrink-0 rounded object-cover ring-1 ring-foreground/10"
								/>
							))}
							<span className="min-w-0 flex-1 truncate text-sm">{text}</span>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Edit ${label}`}
								onClick={() => onEdit(index)}
							>
								<PencilIcon />
							</Button>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Discard ${label}`}
								onClick={() => onDiscard(index)}
							>
								<Trash2Icon />
							</Button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/** Every archived conversation, newest first, to read or bring back. */
function Archived({
	tasks,
	conversations,
	agents,
	onOpen,
	onBack,
}: {
	tasks: Details[];
	conversations: ConversationState[];
	agents: AgentChoice[];
	onOpen: (id: string) => void;
	onBack: (() => void) | null;
}): JSX.Element {
	return (
		<section
			aria-label="archived conversations"
			className="mx-auto flex w-full max-w-xl flex-col gap-2"
		>
			<header className="flex items-center gap-2">
				{onBack !== null && <Back onBack={onBack} />}
				<h2 className="font-medium text-sm">Archived</h2>
			</header>
			{conversations.length === 0 ? (
				<p className="text-muted-foreground text-sm">Nothing archived yet.</p>
			) : (
				<ul className="flex flex-col">
					{conversations.map((each) => (
						<li key={each.id}>
							<Item
								conversation={each}
								agent={agentName(agents, each.agent)}
								need={needOf(tasks, each)}
								current={false}
								onOpen={() => onOpen(each.id)}
								where
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

const SELECT =
	"h-8 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A toast for a request the server refused. */
function refused(title: string, error: unknown): void {
	toast.add({
		title,
		description: error instanceof Error ? error.message : String(error),
		type: "error",
	});
}

/**
 * Keeps what is typed in `runtime`'s composer in `drafts` under `key`, and
 * puts it back as the composer comes up, so leaving for another conversation
 * loses nothing. Hands back what puts text back after a send was refused.
 */
function useDraft(
	runtime: AssistantRuntime,
	drafts: Drafts,
	key: string,
): (text: string, images: File[]) => void {
	useEffect(() => {
		const composer = runtime.thread.composer;
		// Into an empty composer only: what is typed there is the newer draft.
		const fill = () => {
			const kept = drafts.read(key);
			if (kept !== "" && composer.getState().text === "") {
				composer.setText(kept);
			}
		};
		fill();
		const unsubscribe = composer.subscribe(() =>
			drafts.write(key, composer.getState().text),
		);
		// Written from elsewhere: a message Home could not send to it.
		const unlisten = drafts.events.on("written", (written) => {
			if (written === key) {
				fill();
			}
		});
		return () => {
			unsubscribe();
			unlisten();
		};
	}, [runtime, drafts, key]);
	return (text, images) => {
		const composer = runtime.thread.composer;
		// Typed again since it was sent: that is the newer draft.
		if (!composer.getState().isEmpty) {
			return;
		}
		composer.setText(text);
		for (const image of images) {
			void composer.addAttachment(image);
		}
	};
}

/**
 * The images the agent can be sent, held as files until the message goes:
 * PNG, JPEG, GIF and WebP, the ones the server keeps.
 */
class ImageAttachments extends SimpleImageAttachmentAdapter {
	override accept = "image/png,image/jpeg,image/gif,image/webp";
}

const IMAGES = new ImageAttachments();

/** The files of the images attached to `message`. */
function imagesOf(message: AppendMessage): File[] {
	return (message.attachments ?? []).flatMap((each) =>
		each.file === undefined ? [] : [each.file],
	);
}

/**
 * What the cards in conversation `id` answer through: what they send goes to
 * it, and what one keeps goes in `drafts` beside the composer's own.
 */
function useReply(id: string, drafts: Drafts): Reply {
	return useMemo(
		() => ({
			send: (said: string) =>
				void promptConversation(id, said).catch((error: unknown) =>
					refused("Not sent", error),
				),
			drafts: {
				read: (name: string) => drafts.read(`${id}:${name}`),
				write: (name: string, kept: string) =>
					drafts.write(`${id}:${name}`, kept),
			},
		}),
		[id, drafts],
	);
}

/** Whether `runtime`'s composer holds anything typed. */
function useTyped(runtime: AssistantRuntime): boolean {
	const composer = runtime.thread.composer;
	const [typed, setTyped] = useState(() => composer.getState().text !== "");
	useEffect(
		() => composer.subscribe(() => setTyped(composer.getState().text !== "")),
		[composer],
	);
	return typed;
}

/**
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer.
 */
function Thread({
	drafts,
	conversation,
	feed,
	agent,
	task,
	trunk,
	onArchived,
	onOpen,
	onBack,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	conversation: ConversationState;
	/**
	 * What it is fed by, holding a message on its way while the agent starts
	 * or resumes, to be answered as soon as it is up.
	 */
	feed: ConversationFeed;
	/** The agent's name. */
	agent: string;
	/** The task it runs in; null in the main tree, or once the task is gone. */
	task: Details | null;
	/** The main tree's branch. */
	trunk: string;
	/** Once a report card has archived it, to start the next. */
	onArchived: () => void;
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { id, status, settings, archived } = conversation;
	const running = status === "running" || feed.sending.has(id);
	// The last message is still being written while the agent works.
	const writing = status === "running" || status === "starting";
	// What waits for the turn's end sits above the composer, not in the
	// thread: the agent has yet to hear it, and the thread would take it for
	// a turn the agent is answering.
	const queued = conversation.messages.filter((each) => each.queued);
	const messages = useMemo(() => {
		const said = conversation.messages.filter((each) => !each.queued);
		const liked = said.map((message, index) =>
			like(
				message,
				index,
				conversation.id,
				!writing || index < said.length - 1,
				said[index - 1]?.at ?? message.at,
			),
		);
		// The reply's place while the agent has yet to say anything, under the
		// id the reply will take: assistant-ui's own placeholder has an id of its
		// own, so the reply would mount afresh in its place and fade in again.
		return running && said.at(-1)?.role === "user"
			? [
					...liked,
					{ id: String(said.length), role: "assistant" as const, content: [] },
				]
			: liked;
	}, [conversation.messages, conversation.id, writing, running]);
	// Its last word asks questions or for a review: the card takes the focus,
	// not the composer, unless it holds a draft.
	const last = messages.at(-1);
	const asking =
		last?.role === "assistant" &&
		typeof last.content !== "string" &&
		last.content.some(
			(part) => part.type === "data-questions" || part.type === "data-review",
		);
	const restore = useRef<(text: string, images: File[]) => void>(() => {});
	const say = useCallback(
		async (message: AppendMessage) => {
			const text = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			const images = imagesOf(message);
			// The server says nothing of it until the agent is back up.
			const held = status !== "idle" && status !== "running" && text !== "";
			if (held) {
				feed.send(id, text);
			}
			await promptConversation(id, text, images).catch((error: unknown) => {
				if (held) {
					feed.sent(id);
				}
				restore.current(text, images);
				refused("Not sent", error);
				throw error;
			});
		},
		[id, status, feed],
	);
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		// A stopped conversation takes a prompt, which resumes it, and one
		// still starting holds it until the session opens.
		isDisabled: archived,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters: { attachments: IMAGES },
		onNew: say,
		// So the composer takes a message while the agent works. The server
		// decides whether it joins the turn or waits for its end, and shows it
		// in the thread either way, so nothing waits here.
		queue: useMemo(
			() => ({
				items: [],
				steerItems: [],
				enqueue: (message: AppendMessage) => void say(message).catch(() => {}),
				// Every message sent mid-turn comes here; only ⌘⇧↵ sets `steer`,
				// which sends it now, stopping the turn for an agent that cannot
				// take it mid-turn.
				steer: (message: AppendMessage) =>
					void say(message)
						.then(() => (message.steer ? sendQueuedNow(id) : undefined))
						.catch(() => {}),
				move: () => {},
				edit: () => {},
				remove: () => {},
			}),
			[say, id],
		),
		onCancel: async () => {
			await cancelConversation(id).catch((error: unknown) =>
				refused("Not cancelled", error),
			);
		},
	});
	restore.current = useDraft(runtime, drafts, id);
	const section = useRef<HTMLElement>(null);
	const reply = useReply(id, drafts);
	const typed = useTyped(runtime);
	const mentions = useFileMentions(conversation.task);
	const [renaming, setRenaming] = useState(false);
	// Stops the turn so what is queued goes out now.
	const sendNow = () =>
		sendQueuedNow(id).catch((error: unknown) => refused("Not sent", error));
	// Back into the composer to edit, ahead of anything typed there since.
	const edit = async (index: number) => {
		const taken = await unqueueConversation(id, index).catch(
			(error: unknown) => {
				refused("Not taken back", error);
				return null;
			},
		);
		if (taken === null) {
			return;
		}
		const { text, images } = taken;
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`,
		);
		for (const image of images) {
			void composer.addAttachment(image);
		}
		section.current
			?.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message input"]',
			)
			?.focus();
	};
	// Gone before the agent hears it, its words with it.
	const discard = (index: number) =>
		unqueueConversation(id, index).catch((error: unknown) =>
			refused("Not discarded", error),
		);
	const review = useContext(ReviewChanges);
	const terminal = useContext(ToggleTerminal);
	const archive = useArchive(conversation);
	const actions: Action[] = [
		...(review !== null && task !== null && task.ahead !== null
			? [
					{
						label: "Review changes",
						icon: <FileDiffIcon />,
						detail: task.added !== null && (
							<span className="font-mono text-xs">
								<span className="text-success">+{task.added}</span>{" "}
								<span className="text-destructive">−{task.removed ?? 0}</span>
							</span>
						),
						run: () => review(task.task),
					},
				]
			: []),
		...(terminal !== null
			? [
					{
						label: "Terminal",
						icon: <SquareTerminalIcon />,
						detail: <Kbd>{TOGGLE}</Kbd>,
						run: () => terminal(id),
					},
				]
			: []),
		{
			label: archived ? "Unarchive" : "Archive",
			icon: <ArchiveIcon />,
			run: archive.file,
		},
	];
	// The latest, so the card's callback stays the same across renders.
	const onArchivedRef = useRef(onArchived);
	onArchivedRef.current = onArchived;
	const filing = useMemo(
		() => ({
			archived,
			// With the agent, model, and settings the last one started with.
			archive: () => {
				archiveConversation(id, true).then(
					() => onArchivedRef.current(),
					(error: unknown) => refused("Not archived", error),
				);
			},
		}),
		[id, archived],
	);
	// The new conversation screen, with this one's agent picked and `text`
	// typed ahead of anything already waiting there.
	const startNew = useCallback(
		(text: string) => {
			const key = newDraft(new URLSearchParams(location.search).get("project"));
			const kept = drafts.read(key);
			drafts.write(key, kept.trim() === "" ? text : `${text}\n\n${kept}`);
			onOpen(`${NEW}/${conversation.agent}`);
		},
		[drafts, onOpen, conversation.agent],
	);
	const [details, setDetails] = useState(false);
	const needed = need(task, conversation);
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
	// The latest panel of them the agent wrote, else the plan they are in.
	const toQuestions = () => {
		const panels = section.current?.querySelectorAll(
			'[aria-label="questions"]',
		);
		const last = panels?.[panels.length - 1];
		if (last === undefined) {
			setDetails(true);
		} else {
			last.scrollIntoView({ block: "start", behavior: "smooth" });
		}
	};

	return (
		<section
			ref={section}
			aria-label={nameOf(conversation)}
			// Up in an empty composer takes back the last queued message, as a
			// terminal brings back the last command. Enter with nothing typed
			// sends what is queued now, as in Zed; ⌘⇧↵ (Ctrl+Shift+Enter) with
			// something typed sends that now too, as `queue.steer` below. On the
			// way down, so the composer is read before it sends and empties.
			onKeyDownCapture={(event) => {
				const box = event.target as HTMLElement;
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					box.getAttribute("aria-label") === "Message input" &&
					runtime.thread.composer.getState().text === "" &&
					queued.length > 0
				) {
					event.preventDefault();
					event.stopPropagation();
					void sendNow();
					return;
				}
				if (
					event.key === "ArrowUp" &&
					box.getAttribute("aria-label") === "Message input" &&
					runtime.thread.composer.getState().text === "" &&
					queued.length > 0
				) {
					event.preventDefault();
					void edit(queued.length - 1);
				}
			}}
			className="@container flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			<header className="flex min-h-9 items-center gap-2">
				{onBack !== null && <Back onBack={onBack} />}
				<div className="flex min-w-0 flex-1 flex-col">
					{renaming ? (
						<Rename
							conversation={conversation}
							onDone={() => setRenaming(false)}
						/>
					) : (
						// A shortcut: the menu in the sidebar renames too.
						<h2
							onDoubleClick={() => setRenaming(true)}
							title="Double-click to rename"
							className={cn(
								"truncate font-medium text-sm",
								unnamed(conversation) && "text-muted-foreground italic",
							)}
						>
							{nameOf(conversation)}
						</h2>
					)}
					<TaskLine
						branch={branch}
						task={task}
						need={needed}
						onQuestions={toQuestions}
						onDetails={() => setDetails(true)}
					/>
				</div>
				{archived ? (
					<Badge variant="secondary">archived</Badge>
				) : (
					<StatusBadge status={status} />
				)}
				<OverviewButtons actions={actions} />
			</header>
			{archive.confirm}
			{task !== null && (
				<Dialog open={details} onOpenChange={setDetails}>
					{details && <Task task={task} />}
				</Dialog>
			)}
			{conversation.error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{conversation.error}
				</p>
			)}
			<div className="relative min-h-0 flex-1">
				<Overview actions={actions} />
				<AssistantRuntimeProvider runtime={runtime}>
					<QuestionsUI />
					<ReviewUI />
					<ReportUI />
					<TodoUI />
					<WorkUI />
					<ArchiveContext value={filing}>
						<StartNewContext value={startNew}>
							<ReplyContext value={reply}>
								<ThreadView
									autoFocus={!asking || typed}
									mentions={mentions ?? undefined}
									controls={
										!archived &&
										settings.map((setting) => (
											<SettingControl
												key={setting.id}
												setting={setting}
												value={setting.current}
												onChange={(value) =>
													chooseSetting(id, setting.id, value).catch(
														(error: unknown) =>
															refused(`${setting.name} not switched`, error),
													)
												}
											/>
										))
									}
									above={
										<>
											{queued.length > 0 && (
												<Queued
													conversation={id}
													messages={queued}
													onEdit={(index) => void edit(index)}
													onDiscard={(index) => void discard(index)}
													onSendNow={() => void sendNow()}
												/>
											)}
											{conversation.ask !== null && (
												<AskPanel
													key={conversation.ask.id}
													drafts={drafts}
													conversation={conversation}
													agent={agent}
													ask={conversation.ask}
												/>
											)}
										</>
									}
								/>
							</ReplyContext>
						</StartNewContext>
					</ArchiveContext>
				</AssistantRuntimeProvider>
			</div>
		</section>
	);
}

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * A message as assistant-ui takes one, the one place ACP's shape meets
 * assistant-ui's. An agent's turn is its reply, the last text it said, after
 * one `data-work` part holding everything else it did.
 */
function like(
	message: Message,
	index: number,
	/** The conversation it is in, to read its images from. */
	conversation: string,
	settled = true,
	/** When the turn began: the person's prompt it answers. */
	began: string | null = message.at,
): ThreadMessageLike {
	const id = String(index);
	if (message.role === "user") {
		return {
			id,
			role: "user",
			content: message.parts.flatMap((part) =>
				part.type === "text"
					? [{ type: "text" as const, text: part.text }]
					: [],
			),
			// Shown as tiles above the words, each opening full size.
			attachments: message.parts.flatMap((part) =>
				part.type === "image" ? [attached(conversation, part)] : [],
			),
		};
	}
	// The last thing it said, even with tool calls after it: a turn that
	// ends on one, or is still going, would otherwise fold its words away.
	const said = message.parts.findLastIndex(
		(part) => part.type === "text" && part.text.trim() !== "",
	);
	const last = message.parts[said];
	const reply = last?.type === "text" ? last.text : "";
	const work: Work = {
		parts: message.parts,
		reply: said === -1 ? null : said,
		plan: message.plan,
		at: began,
		until: message.until,
		running: !settled,
	};
	return {
		id,
		role: "assistant",
		content: [
			...(message.parts.length > (said === -1 ? 0 : 1) || message.plan !== null
				? [{ type: "data-work" as const, data: { work } }]
				: []),
			...(reply === "" ? [] : replied(reply, settled)),
		],
	};
}

/** An image the person sent, as assistant-ui shows an attachment. */
function attached(
	conversation: string,
	image: Image,
): NonNullable<ThreadMessageLike["attachments"]>[number] {
	return {
		id: image.name,
		type: "image",
		name: image.name,
		contentType: image.mimeType,
		status: { type: "complete" },
		content: [{ type: "image", image: conversationImage(conversation, image) }],
	};
}

/**
 * The agent's reply, its questions and review as cards once it has stopped
 * writing them: a list mid-stream may yet turn out not to ask any.
 */
function replied(text: string, settled: boolean): LikePart[] {
	if (!settled) {
		return [{ type: "text", text }];
	}
	return stretches(text).map((stretch): LikePart => {
		switch (stretch.type) {
			case "text":
				return { type: "text", text: stretch.text };
			case "questions":
				return {
					type: "data-questions",
					data: { questions: stretch.questions },
				};
			case "review":
				return { type: "data-review", data: { review: stretch.review } };
			case "report":
				return { type: "data-report", data: { report: stretch.report } };
			case "todo":
				return { type: "data-todo", data: { todo: stretch.todo } };
			default:
				return stretch satisfies never;
		}
	});
}

/** The tree's paths for the composer's `@`, once they have loaded. */
function useFileMentions(task: string | null): TriggerAdapter | null {
	const [all, setAll] = useState<string[] | null>(null);
	useEffect(() => {
		let current = true;
		paths(task ?? "").then(
			(found) => current && setAll(found),
			// Without the list, `@` is only a character: nothing else breaks.
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, [task]);
	return useMemo(
		() =>
			all === null
				? null
				: {
						categories: () => [],
						categoryItems: () => [],
						search: (query: string) =>
							(query === "" ? all : rank(all, query))
								.slice(0, MENTIONS_SHOWN)
								.map((path) => ({ id: path, type: "file", label: path })),
					},
		[all],
	);
}

const MENTIONS_SHOWN = 8;

/** Where the agent is, unless at rest: idle, or stopped until the next prompt. */
function StatusBadge({ status }: { status: Status }): JSX.Element | null {
	if (status === "idle" || status === "stopped") {
		return null;
	}
	return (
		<Badge variant={status === "failed" ? "destructive" : "secondary"}>
			{status}
		</Badge>
	);
}

/** What the agent is waiting on, answered in place or skipped. */
function AskPanel({
	drafts,
	conversation,
	agent,
	ask,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	conversation: ConversationState;
	agent: string;
	ask: Ask;
}): JSX.Element {
	// Its own draft beside the composer's: what is typed into its boxes.
	const key = `${conversation.id}:${ask.id}`;
	const send = (answer: Answer) =>
		answerConversation(conversation.id, ask.id, answer).then(
			() => drafts.write(key, ""),
			(error: unknown) => refused("Not answered", error),
		);
	return ask.type === "permission" ? (
		<Permission
			ask={ask}
			agent={agent}
			where={conversation.task ?? "the main tree"}
			send={send}
		/>
	) : (
		<Question
			ask={ask}
			send={send}
			typed={typedIn(drafts.read(key))}
			onType={(typed) => drafts.write(key, JSON.stringify(typed))}
		/>
	);
}

/** The boxes' draft as `Question` keeps it, or none for one that is not. */
function typedIn(draft: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(draft);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, string>)
			: {};
	} catch {
		return {};
	}
}

/**
 * A permission, through assistant-ui's grant: Deny, This session, and Always
 * stand for ACP's reject, allow once, and allow always, and digits 1 to 3
 * pick them in that order.
 */
function Permission({
	ask,
	agent,
	where,
	send,
}: {
	ask: Extract<Ask, { type: "permission" }>;
	agent: string;
	where: string;
	send: (answer: Answer) => Promise<unknown>;
}): JSX.Element {
	const grant = (scope: "denied" | "session" | "always") => {
		const kinds = {
			denied: ["reject_once", "reject_always"],
			session: ["allow_once", "allow_always"],
			always: ["allow_always", "allow_once"],
		}[scope];
		const option = kinds
			.map((kind) => ask.options.find((each) => each.kind === kind))
			.find((each) => each !== undefined);
		if (option !== undefined) {
			void send({ type: "permission", option: option.id });
		}
	};
	useEffect(() => {
		const pick = (event: KeyboardEvent) => {
			const scope = (["denied", "session", "always"] as const)[
				Number(event.key) - 1
			];
			const typing =
				event.target instanceof HTMLElement &&
				event.target.closest("input, textarea, select") !== null;
			if (scope !== undefined && !typing) {
				event.preventDefault();
				grant(scope);
			}
		};
		addEventListener("keydown", pick);
		return () => removeEventListener("keydown", pick);
	});
	return (
		<PermissionGrant
			aria-label="permission"
			capability={ask.title}
			requester={agent}
			reach={[`in ${where}`]}
			scope="pending"
			onGrant={grant}
			className="max-w-none"
		/>
	);
}

/**
 * A question form, through assistant-ui's question flow: each field with
 * choices is a step, and each field without, such as Claude's "Other", a box
 * filled in before the last step is picked.
 */
function Question({
	ask,
	send,
	typed: drafted,
	onType,
}: {
	ask: Extract<Ask, { type: "question" }>;
	send: (answer: Answer) => Promise<unknown>;
	/** What was typed into its boxes before, by field. */
	typed: Record<string, string>;
	/** Called with what is in its boxes whenever one changes. */
	onType: (typed: Record<string, string>) => void;
}): JSX.Element {
	const [typed, setTyped] = useState(drafted);
	const steps = ask.fields.flatMap((field) =>
		field.choices === null
			? []
			: [
					{
						id: field.key,
						question: field.title,
						description: field.description ?? undefined,
						options: field.choices.map((choice) => ({
							id: choice.value,
							label: choice.title,
							description: choice.description ?? undefined,
						})),
					},
				],
	);
	const boxes = ask.fields.filter((field) => field.choices === null);
	const answer = async (picked: Record<string, string[]>) => {
		await send({
			type: "question",
			values: {
				...Object.fromEntries(
					Object.entries(picked).map(([key, [value]]) => [key, value ?? ""]),
				),
				...typed,
			},
		});
	};
	return (
		<form
			aria-label="question"
			className="flex flex-col gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				void answer({});
			}}
		>
			<p className="font-medium text-sm">{ask.message}</p>
			{steps.length > 0 && (
				<QuestionFlow
					steps={steps}
					onComplete={answer}
					completeLabel="Answer"
					className="max-w-none"
				/>
			)}
			{boxes.map((field) => (
				<input
					key={field.key}
					aria-label={field.title}
					placeholder={field.description ?? field.title}
					value={typed[field.key] ?? ""}
					onChange={(event) => {
						const next = { ...typed, [field.key]: event.target.value };
						setTyped(next);
						onType(next);
					}}
					className={cn(SELECT, "w-full")}
				/>
			))}
			<div className="flex gap-2">
				{steps.length === 0 && (
					<Button type="submit" size="sm">
						Answer
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => void send({ type: "dismiss" })}
				>
					Skip
				</Button>
			</div>
		</form>
	);
}

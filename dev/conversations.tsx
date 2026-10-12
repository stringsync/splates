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
	CheckIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDotIcon,
	ClipboardCheckIcon,
	EllipsisVerticalIcon,
	FileDiffIcon,
	GitBranchIcon,
	LinkIcon,
	ListTodoIcon,
	Loader2Icon,
	MonitorIcon,
	PencilIcon,
	PlusIcon,
	SendHorizontalIcon,
	SquareArrowOutUpRightIcon,
	SquareTerminalIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import {
	type JSX,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Annotation } from "#dev/annotation.ts";
import { PermissionGrant } from "#dev/components/assistant-ui/elements/permission-grant.tsx";
import { QuestionFlow } from "#dev/components/assistant-ui/elements/question-flow.tsx";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
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
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#dev/components/ui/select.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import { type Ending, type Report, stretches } from "../asked";
import type {
	Answer,
	Ask,
	ConversationState,
	Image,
	Message,
	Setting,
} from "../conversations";
import { type LaneRecord, named } from "../lanes";
import { modelOption } from "../models";
import { type Need, type Needing, need, needs } from "../needs";
import type { Question as Asked } from "../plan";
import { leadingDirectives, taskReference, todoReference } from "../prompts";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { type Action, ActionButtons, Actions } from "./actions";
import { AgentBrand, AgentIcon } from "./agent-icons";
import {
	answerConversation,
	archiveConversation,
	cancelConversation,
	chooseSetting,
	conversationImage,
	markUnread,
	paths,
	promptConversation,
	renameConversation,
	sendQueuedNow,
	startConversation,
	unqueueConversation,
} from "./api";
import { Back } from "./back";
import { Board } from "./board";
import { copiedLabel, useCopy } from "./card";
import { ReviewChanges } from "./changes";
import { CheckpointButton } from "./checkpoint";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import {
	DIRECTIVE_TYPE,
	DirectiveChip,
	directivesOf,
	liftDirectives,
	withDirectives,
} from "./directives";
import { Trunk, whereRuns } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { FullscreenButton } from "./fullscreen";
import { rank } from "./mentions";
import { useNotifier } from "./notifications";
import { type Nested, nest } from "./parts";
import {
	QuestionCards,
	QuestionsUI,
	type Reply,
	ReplyContext,
	ReviewUI,
} from "./question-cards";
import { useReferences } from "./references";
import { Refusal, type Refuse, useRefusal, useRefusals } from "./refusal";
import {
	ArchiveContext,
	ReportUI,
	StartNewContext,
	TodoUI,
} from "./report-cards";
import type { Settings } from "./settings";
import {
	arriveAt,
	arriving,
	openQuestions,
	questionsAction,
	replyCopied,
	TASK,
	TaskLine,
	TaskView,
	toWaiting,
	useArrived,
	useCopiedReplies,
} from "./task-view";
import { Task, TaskStatus } from "./tasks";
import { MainTerminal, ShellRunning, ToggleTerminal } from "./terminal";
import { TOGGLE } from "./terminal-session";
import { isMain, numberOf, type Terminals } from "./terminals";
import { TodoDialog } from "./todos";
import { unanswered } from "./unanswered";
import { WaitingLine } from "./waiting-line";
import type { Work } from "./work";
import { WorkUI } from "./work-row";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";
/**
 * In place of an id in the address: the screen that starts a conversation,
 * with the agent after it, as `new/codex`, else the agent last used, and
 * after that the task whose tree it starts in, as `new/codex/fix-upload`,
 * else the main tree.
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
	const named = open?.startsWith(`${NEW}/`)
		? pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[0]
		: null;
	return (
		agents.find((each) => each.id === named)?.id ??
		agents.find((each) => each.id === conversations[0]?.agent)?.id ??
		agents[0]?.id ??
		""
	);
}

/** The task a new conversation starts in, from `open`; null for the main tree. */
function taskFor(open: string | null): string | null {
	return open?.startsWith(`${NEW}/`)
		? (pathOf(open)
				.slice(NEW.length + 1)
				.split("/")[1] ?? null)
		: null;
}

/** The model a new conversation starts on, `?model=` in `open`, or null. */
function modelFor(open: string | null): string | null {
	const at = open?.indexOf("?") ?? -1;
	return open === null || at === -1
		? null
		: new URLSearchParams(open.slice(at + 1)).get("model");
}

/** `open` without its `?` and what follows. */
function pathOf(open: string): string {
	return open.split("?")[0] ?? open;
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
 * name already says so, as a finished task's name does.
 */
function whereOf(
	conversation: ConversationState,
	trunk: string | null,
): string | null {
	if (nameOf(conversation) === conversation.lastTask) {
		return null;
	}
	return whereRuns(conversation.task, trunk);
}

/**
 * What a conversation goes by: the name the person gave it, else the task its
 * agent holds, so it follows the agent from task to task, or held last, so a
 * finished task keeps its name until the agent takes another, else the agent's
 * title. Until it has one, a stand-in (see `unnamed`): the first line of what
 * the person first said, else "Not started".
 */
export function nameOf(conversation: ConversationState): string {
	return (
		conversation.name ??
		conversation.lastTask ??
		conversation.title ??
		openingOf(conversation) ??
		"Not started"
	);
}

/** Whether `nameOf` is a stand-in, shown muted until a real name comes. */
function unnamed(conversation: ConversationState): boolean {
	return (
		conversation.name === null &&
		conversation.lastTask === null &&
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

/**
 * The sidebar's conversations, under New, in one list, newest first, after
 * the main tree's own terminals, oldest first, until each is closed. Each
 * row is named alone, with its task on hover. A conversation follows its agent
 * as it takes and lands tasks. A task whose agent runs outside the page is a
 * row of its own. Rows stay put as their agents change state; each one's mark
 * says whether it works or waits on you. Archived ones sit behind a link at
 * the bottom.
 *
 * The arrow keys move between rows, ⌥⌘N (Ctrl+Alt+N off a Mac) starts a new
 * one as the last was started, ⌥⌘0 to ⌥⌘9 open the first ten rows, top
 * to bottom, and ⌥⌘] and ⌥⌘[ open the row below or above the one open,
 * terminals among them, round past either end. Holding ⌥⌘ shows each of those keys beside what it opens. Its
 * actions, ⌥⌘M among them, are `ConversationActions`, apart from it.
 * As `settings` say, it notifies of an agent that comes to wait on you,
 * finishes its turn, or goes quiet.
 */
export function ConversationList({
	feed,
	terminals,
	drafts,
	tasks,
	settings,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** The page's shells, the main tree's among them. */
	terminals: Terminals;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
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
	const { mains } = useReactive(
		terminals,
		(terminals) => ({ mains: terminals.mains }),
		["changed"],
	);

	const listed = conversations.filter((each) => !each.archived);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const archived = conversations.length - listed.length;
	const nested = nest(rows, tasks, taskOfRow);
	// As they show, each part under its task: what ⌥⌘0 to ⌥⌘9 open.
	const shown = flatten(nested).slice(0, DIGITS);
	const held = useHeld();
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
	const openRowRef = useRef(openRow);
	openRowRef.current = openRow;
	const shownRef = useRef(shown);
	shownRef.current = shown;
	// Every row top to bottom, by what opens it: what ⌥⌘[ and ⌥⌘] step through.
	const stops = [
		...mains,
		...flatten(nested).flatMap((row) =>
			row.conversation !== null
				? [row.conversation.id]
				: row.task !== null
					? [`${TASK}${row.task.task}`]
					: [],
		),
	];
	const stopsRef = useRef(stops);
	stopsRef.current = stops;
	const openRef = useRef(open);
	openRef.current = open;
	// Whether the New menu last closed on an agent, which its focus follows.
	const picked = useRef(false);
	useEffect(() => {
		const jump = (event: KeyboardEvent) => {
			const digit = /^Digit(\d)$/.exec(event.code)?.[1];
			if (
				digit !== undefined &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				const row = shownRef.current[Number(digit)];
				if (row !== undefined) {
					event.preventDefault();
					openRowRef.current(row);
				}
				return;
			}
			// By the key's place, since Alt types another letter on a Mac.
			if (!event.altKey || !(event.metaKey || event.ctrlKey)) {
				return;
			}
			if (event.code === "KeyN") {
				event.preventDefault();
				// With the agent, model, and settings the last one started with.
				onOpenRef.current(NEW);
				return;
			}
			const step =
				event.code === "BracketRight"
					? 1
					: event.code === "BracketLeft"
						? -1
						: 0;
			const stops = stopsRef.current;
			if (step === 0 || stops.length === 0) {
				return;
			}
			event.preventDefault();
			// From a row, round past either end; from no row, in from the top or
			// the bottom.
			const at = stops.indexOf(openRef.current ?? "");
			const to =
				at === -1
					? step === 1
						? 0
						: stops.length - 1
					: (at + step + stops.length) % stops.length;
			onOpenRef.current(stops[to] ?? null);
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
					<span className="flex-1">New</span>
					{held ? (
						<Kbd aria-hidden>N</Kbd>
					) : (
						<ChevronDownIcon className="size-3.5 text-muted-foreground" />
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="w-44"
					// Into the composer of the conversation picked, ready to type, rather
					// than back to New; otherwise as usual.
					finalFocus={() => {
						if (!picked.current) {
							return true;
						}
						picked.current = false;
						return (
							document.querySelector<HTMLTextAreaElement>(
								'section[aria-label="new conversation"] textarea[aria-label="Message input"]',
							) ?? true
						);
					}}
				>
					{agents.map((each) => (
						<DropdownMenuItem
							key={each.id}
							onClick={() => {
								picked.current = true;
								onOpen(`${NEW}/${each.id}`);
							}}
						>
							<AgentIcon agent={each.id} name={each.name} />
							{each.name}
							{each.id === agentFor(NEW, agents, conversations) && (
								<Kbd className="ml-auto">⌥⌘N</Kbd>
							)}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => onOpen(terminals.another())}>
						<SquareTerminalIcon />
						Terminal
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			{mains.map((each) => (
				<TerminalRow
					key={each}
					name={`Terminal ${numberOf(each)}`}
					current={open === each}
					onOpen={() => onOpen(each)}
					onClose={() => {
						if (open === each) {
							onOpen(NEW);
						}
						terminals.close(each);
					}}
				/>
			))}
			<Rows
				label="conversation list"
				rows={nested}
				render={(row) =>
					row.conversation !== null ? (
						<Item
							conversation={row.conversation}
							agent={agentName(agents, row.conversation.agent)}
							need={row.need}
							current={row.conversation.id === open}
							onOpen={() => openRow(row)}
							hint={held ? hintOf(shown, row) : null}
						/>
					) : (
						row.task !== null && (
							<External
								task={row.task}
								need={row.need}
								copied={copiedFor(drafts, null, row.task, row.need)}
								current={`${TASK}${row.task.task}` === open}
								onOpen={() => openRow(row)}
								hint={held ? hintOf(shown, row) : null}
							/>
						)
					)
				}
			/>
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
				{archived > 0 && <span className="tabular-nums">{archived}</span>}
			</button>
		</nav>
	);
}

/**
 * What the conversations can be asked to do as a whole, kept apart from the
 * list, which holds only where to go: a line saying how many agents wait on
 * you, which opens the next as ⌥⌘M (Ctrl+Alt+M off a Mac) does, and
 * Checkpoint, which ⌥⌘C opens. ⌥⌘M opens the next one waiting, or else the next merged, then
 * unread, one, and lights the line when there is none.
 */
export function ConversationActions({
	feed,
	drafts,
	tasks,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	/** Where a reply copied for an external agent is kept. */
	drafts: Drafts;
	tasks: Details[];
	/** The conversation shown, by id, or `ARCHIVED`. */
	open: string | null;
	onOpen: (id: string | null) => void;
}): JSX.Element {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	const rows = rowsOf(tasks, conversations);
	useCopiedReplies(drafts);
	const held = useHeld();
	// Each time ⌥⌘M finds nothing to open, for the waiting line to say so.
	const [nudges, setNudges] = useState(0);
	// The latest, for the listener below, which outlives a render.
	const next = useRef(() => {});
	next.current = () => {
		const waiting = nextWaiting(rows, drafts, open, true);
		if (waiting !== undefined) {
			arriveAt(openedBy(waiting));
			onOpen(openedBy(waiting));
		} else {
			setNudges((nudges) => nudges + 1);
		}
	};
	useEffect(() => {
		const jump = (event: KeyboardEvent) => {
			// By the key's place, since Alt types another letter on a Mac.
			if (
				event.code === "KeyM" &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				next.current();
			}
		};
		document.addEventListener("keydown", jump);
		return () => document.removeEventListener("keydown", jump);
	}, []);

	return (
		<div className="flex flex-col gap-0.5">
			<WaitingLine
				waiting={rows.filter((row) => waitsOnYou(row, drafts)).length}
				nudges={nudges}
				held={held}
				onNext={() => next.current()}
			/>
			<CheckpointButton
				conversations={conversations.filter((each) => !each.archived)}
				held={held}
			/>
			<FullscreenButton held={held} />
		</div>
	);
}

/** What archives the open conversation, or brings it back. */
const ARCHIVE = "⌥⌘⌫";

/** How many rows ⌥⌘ and a digit can open. */
const DIGITS = 10;

/** A main-tree terminal in the list, with an X that hangs up its shell. */
function TerminalRow({
	name,
	current,
	onOpen,
	onClose,
}: {
	name: string;
	current: boolean;
	onOpen: () => void;
	onClose: () => void;
}): JSX.Element {
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-accent hover:bg-accent",
			)}
		>
			<button
				type="button"
				data-row
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-8 pl-3 text-left"
			>
				<SquareTerminalIcon className="size-3.5 text-foreground/70" />
				<span className="min-w-0 flex-1 truncate text-sm">{name}</span>
			</button>
			<Button
				size="icon-xs"
				variant="ghost"
				aria-label={`Close ${name}`}
				title={`Close ${name}`}
				className="absolute right-1 opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100"
				onClick={onClose}
			>
				<XIcon />
			</Button>
		</div>
	);
}

/** Nested rows in the order they show, each part under its task. */
function flatten<Row>(rows: Nested<Row>[]): Row[] {
	return rows.flatMap(({ row, parts }) => [row, ...flatten(parts)]);
}

/** The digit that opens `row` with ⌥⌘, or null past the tenth. */
function hintOf(shown: Needing[], row: Needing): string | null {
	const at = shown.indexOf(row);
	return at === -1 ? null : String(at);
}

/**
 * Whether ⌥⌘ (Ctrl+Alt off a Mac) is held down, to show the keys that go
 * with it. Leaving the window lets go, since its key-ups go elsewhere.
 */
export function useHeld(): boolean {
	const [held, setHeld] = useState(false);
	useEffect(() => {
		const check = (event: KeyboardEvent) =>
			setHeld(event.altKey && (event.metaKey || event.ctrlKey));
		const release = () => setHeld(false);
		window.addEventListener("keydown", check);
		window.addEventListener("keyup", check);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("keydown", check);
			window.removeEventListener("keyup", check);
			window.removeEventListener("blur", release);
		};
	}, []);
	return held;
}

/** The sidebar's rows, newest first: the conversations listed, then external agents. */
function rowsOf(
	tasks: Details[],
	conversations: ConversationState[],
): Needing[] {
	const external = needs({ tasks, conversations }).filter(
		(each) => each.conversation === null,
	);
	return [
		...conversations
			.filter((each) => !each.archived)
			.map((conversation) => ({
				conversation,
				task: null,
				need: needOf(tasks, conversation),
			})),
		...external,
	].toSorted((one, other) => started(other).localeCompare(started(one)));
}

/** What opens `row`: its conversation's id, or its external agent's task. */
function openedBy(row: Needing): string {
	return row.conversation?.id ?? `${TASK}${row.task?.task ?? ""}`;
}

/**
 * The next of `rows` that waits on you after the one `open` shows, around to
 * the top, or with `settled` and none waiting, the next merged one, then the
 * next unread one: what ⌥⌘M opens. The one open comes last, so ⌥⌘M on the
 * only one waiting goes back to its questions.
 */
function nextWaiting(
	rows: Needing[],
	drafts: Drafts,
	open: string | null,
	settled = false,
): Needing | undefined {
	const at = rows.findIndex((row) => openedBy(row) === open);
	const around = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
	const waiting = around.find((row) => waitsOnYou(row, drafts));
	if (waiting !== undefined || !settled) {
		return waiting;
	}
	return around.find(wasMerged) ?? around.find(isUnread);
}

/** Whether `row` shows as merged in the sidebar. */
function wasMerged({ conversation, need }: Needing): boolean {
	return (
		conversation !== null &&
		reportedAs(conversation) === "merged" &&
		(need.kind === "idle" ||
			(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed"))
	);
}

/** Whether `row` shows as unread in the sidebar. */
function isUnread({ conversation, need }: Needing): boolean {
	return (
		conversation?.unread === true &&
		need.kind === "idle" &&
		reportedAs(conversation) !== "escalated"
	);
}

/** The task a sidebar row is on, which its parts nest under. */
function taskOfRow(row: Needing): string | null {
	return row.conversation?.task ?? row.task?.task ?? null;
}

/** A row's key: its conversation's id, or its external agent's task. */
function keyOfRow(row: Needing): string {
	return row.conversation?.id ?? `external ${row.task?.task ?? ""}`;
}

/**
 * The sidebar's rows as a list, each part's under the row of the task it was
 * handed out from, in a list of its own, indented.
 */
function Rows({
	label,
	rows,
	render,
	nested = false,
}: {
	label: string;
	rows: Nested<Needing>[];
	render: (row: Needing) => ReactNode;
	nested?: boolean;
}): JSX.Element {
	return (
		<ul
			aria-label={label}
			className={cn(
				"flex flex-col",
				nested && "ml-4 border-foreground/10 border-l pl-1",
			)}
		>
			{rows.map(({ row, parts }) => (
				<li key={keyOfRow(row)}>
					{render(row)}
					{parts.length > 0 && (
						<Rows
							label={`parts of ${taskOfRow(row) ?? ""}`}
							rows={parts}
							render={render}
							nested
						/>
					)}
				</li>
			))}
		</ul>
	);
}

/**
 * How many agents wait on the person: conversations, and tasks whose agents
 * run outside the page, but for those whose reply was copied.
 */
export function useWaiting(
	feed: ConversationFeed,
	drafts: Drafts,
	tasks: Details[],
): number {
	const { conversations } = useReactive(
		feed,
		(feed) => ({ conversations: feed.conversations }),
		["changed"],
	);
	useCopiedReplies(drafts);
	return needs({ tasks, conversations }).filter(
		({ conversation, task, need }) =>
			need.kind === "waiting" && !copiedFor(drafts, conversation, task, need),
	).length;
}

/** Whether a row is an external agent whose reply was copied, to paste. */
function copiedFor(
	drafts: Drafts,
	conversation: ConversationState | null,
	task: Details | null,
	need: Need,
): boolean {
	return (
		conversation === null &&
		task !== null &&
		replyCopied(drafts, task.task, need)
	);
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
	copied,
	current,
	onOpen,
	hint = null,
}: {
	task: Details;
	need: Need;
	/** Whether the reply to its open questions was copied, to paste. */
	copied: boolean;
	current: boolean;
	onOpen: () => void;
	/** The key that opens it with ⌥⌘, while ⌥⌘ is held. */
	hint?: string | null;
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
			{hint !== null ? (
				<Kbd aria-hidden>{hint}</Kbd>
			) : need.kind === "working" || need.kind === "assuming" ? (
				<Elsewhere />
			) : copied ? (
				<Copied />
			) : (
				<Mark need={need} />
			)}
		</button>
	);
}

/**
 * What a list shows of an external agent whose questions were all answered
 * and the reply copied, in place of its alert: the page cannot tell whether
 * it was pasted, only that it is with you to.
 */
function Copied(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="reply copied"
			title="Reply copied: paste it into its session"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<ClipboardCheckIcon className="size-3.5 text-foreground/60" />
		</span>
	);
}

/**
 * What a list shows of an external agent at work, in place of a spinner: the
 * page cannot see whether it is still going, only that its task is under way
 * somewhere else, so it stays still.
 */
function Elsewhere(): JSX.Element {
	return (
		<span
			role="status"
			aria-label="working elsewhere"
			title="Working outside this page"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<MonitorIcon className="size-3.5 text-foreground/60" />
		</span>
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
	hint = null,
}: {
	conversation: ConversationState;
	agent: string;
	need: Need;
	current: boolean;
	onOpen: () => void;
	/** Whether to say where it ran, rather than only on hover. */
	where?: boolean;
	/** The key that opens it with ⌥⌘, while ⌥⌘ is held. */
	hint?: string | null;
}): JSX.Element {
	const [menu, setMenu] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const { copied, copy } = useCopy();
	const trunk = useContext(Trunk);
	const { id, archived } = conversation;
	const { refusal, refuse } = useRefusal();
	const { file, confirm } = useArchive(conversation, refuse);
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
				<Rename
					conversation={conversation}
					refuse={refuse}
					onDone={() => setRenaming(false)}
				/>
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
						: need.kind === "idle" &&
								reported === null &&
								!conversation.unread &&
								hint === null
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
				{where && whereOf(conversation, trunk) !== null && (
					<span className="shrink-0 truncate text-muted-foreground text-xs">
						{whereOf(conversation, trunk)}
					</span>
				)}
			</button>
			<span
				className={cn(
					"pointer-events-none absolute right-2 flex items-center pointer-coarse:right-16",
					renaming && "hidden",
					menu
						? "hidden"
						: hint === null &&
								"group-focus-within/item:hidden group-hover/item:hidden",
				)}
			>
				{hint !== null ? (
					<Kbd aria-hidden>{hint}</Kbd>
				) : (
					<Mark need={need} reported={reported} unread={conversation.unread} />
				)}
			</span>
			<span
				className={cn(
					"absolute right-1 flex items-center",
					// Its keys show in their place while ⌥⌘ is held.
					(renaming || (hint !== null && !menu)) && "hidden",
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
						{/* The one open would be read again at once. */}
						{!current && !conversation.unread && !archived && (
							<DropdownMenuItem
								onClick={() =>
									void markUnread(id, true).catch((error: unknown) =>
										refuse("Not marked unread", error),
									)
								}
							>
								<CircleDotIcon />
								Mark as unread
							</DropdownMenuItem>
						)}
						<DropdownMenuItem onClick={() => file()}>
							<Put />
							{put}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`${put} ${nameOf(conversation)}`}
					onClick={() => file()}
				>
					<Put />
				</Button>
			</span>
			<Refusal refusal={refusal} className="w-full px-3 pb-1.5" />
		</div>
	);
}

/**
 * Archives `conversation`, or brings it back, then runs `then`. While its
 * agent works, or sits idle with its shell up, `file` asks first in
 * `confirm`, since archiving stops both; render `confirm` beside whatever
 * calls `file`.
 */
function useArchive(
	conversation: ConversationState,
	refuse: Refuse,
): {
	file: (then?: () => void) => void;
	confirm: JSX.Element;
} {
	const [asking, setAsking] = useState(false);
	// Held while `confirm` asks.
	const after = useRef<(() => void) | undefined>(undefined);
	const shellRunning = useContext(ShellRunning);
	const { id, archived } = conversation;
	const put = () =>
		void archiveConversation(id, !archived).then(
			() => after.current?.(),
			(error: unknown) =>
				refuse(archived ? "Not unarchived" : "Not archived", error),
		);
	const working =
		conversation.status === "starting" || conversation.status === "running";
	// Idle, only its shell can lose anything, like a dev server it runs; asked
	// as it is clicked, since the shell comes and goes without a render here.
	const file = (then?: () => void) => {
		after.current = then;
		if (
			!archived &&
			(working || (conversation.status === "idle" && shellRunning(id)))
		) {
			setAsking(true);
		} else {
			put();
		}
	};
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
	refuse,
	onDone,
}: {
	conversation: ConversationState;
	refuse: Refuse;
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
						.catch((error: unknown) => refuse("Not renamed", error))
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
 * What a list shows of an agent, one of four marks: an amber alert when it
 * waits on you, whatever for, a spinner while it works, assuming or not, a
 * blue dot when it answered and you have not looked since, and a green
 * check once its task merged, over the dot. Anything else, idle or removed, shows an empty
 * space. A report in its last word decides the mark over a wait it ended,
 * though not over a live ask or a failure, which are newer. What it waits on
 * is in its tooltip. Each sits centered in a box of one size, so marks line
 * up down a list whichever kind they are.
 */
export function Mark({
	need,
	reported = null,
	unread = false,
}: {
	need: Need;
	reported?: Ending | null;
	unread?: boolean;
}): JSX.Element {
	const shows =
		need.kind === "idle" ||
		(need.kind === "waiting" && need.why !== "ask" && need.why !== "failed");
	if (reported === "merged" && shows) {
		return (
			<CircleCheckIcon
				role="img"
				aria-label="merged"
				className="size-3.5 shrink-0 text-success"
			/>
		);
	}
	if (unread && need.kind === "idle" && reported !== "escalated") {
		return (
			<span
				role="status"
				aria-label="unread"
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<span className="size-2 rounded-full bg-info" />
			</span>
		);
	}
	if (need.kind === "waiting" || (reported === "escalated" && shows)) {
		return (
			<span
				role="status"
				aria-label="waiting on you"
				title={need.kind === "waiting" ? need.subject : undefined}
				className="flex size-3.5 shrink-0 items-center justify-center"
			>
				<CircleAlertIcon className="size-3.5 text-warning" />
			</span>
		);
	}
	if (need.kind === "idle") {
		// Empty, so what sits beside it lines up with the rows that have one.
		return <span className="size-3.5 shrink-0" />;
	}
	return (
		<span
			role="status"
			aria-label="working"
			className="flex size-3.5 shrink-0 items-center justify-center"
		>
			<Loader2Icon className="size-3.5 animate-spin text-foreground/60" />
		</span>
	);
}

/**
 * How the task ended, or that it escalated, when the conversation's last word
 * is the agent's report saying so. Anything the person says after it carries
 * the conversation on, and the report goes.
 */
export function reportedAs(conversation: ConversationState): Ending | null {
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

/**
 * The open conversation, or the archived ones when `open` is `ARCHIVED`. On a
 * phone, where there is no sidebar, it is one or the other: the list until a
 * conversation is opened, then that alone, with a way back.
 */
export function Conversations({
	feed,
	terminals,
	drafts,
	tasks,
	todos,
	lanes,
	trunk,
	open,
	onOpen,
	phone,
}: {
	feed: ConversationFeed;
	/** The page's shells, the main tree's among them. */
	terminals: Terminals;
	/**
	 * What was typed and not sent, by conversation: the page's, so a prompt
	 * composed elsewhere on it reaches the composer it was meant for.
	 */
	drafts: Drafts;
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
	// A todo a conversation mentions opens over it, and the task that took
	// one over that, so the conversation keeps its place.
	const [openedTodo, setOpenedTodo] = useState<number | null>(null);
	const [openedTask, setOpenedTask] = useState<string | null>(null);
	const board = useMemo(
		() => ({
			linked: true,
			todos,
			lanes: named(todos, lanes),
			open: setOpenedTodo,
			openTask: setOpenedTask,
			moveLane: () => {},
			refusedTodos: new Map(),
			refusedLanes: new Map(),
			refuseLane: () => {},
			drafts,
		}),
		[todos, lanes, drafts],
	);
	const todo = todos.find((each) => each.id === openedTodo);
	const task = tasks.find((each) => each.task === openedTask);
	// What a main-tree conversation can take up: a live task no listed
	// conversation runs in, nor one about to. `arbor claim` refuses one an
	// external agent still holds, so its agent says so.
	const free = tasks.filter(
		(each) =>
			["working", "escalated"].includes(each.status) &&
			!each.dispatched &&
			!conversations.some(
				(conversation) =>
					!conversation.archived && conversation.task === each.task,
			),
	);
	// By conversation, so a message Home sends to one it just started can be
	// refused in that one's thread.
	const { refusals, refuse } = useRefusals<string>();
	useRead(shown);

	return (
		<Board value={board}>
			<div className="flex flex-col gap-4">
				{phone && open === null ? (
					<>
						<ConversationList
							feed={feed}
							terminals={terminals}
							drafts={drafts}
							tasks={tasks}
							// A phone's browser notifies only from a service worker, and
							// this list comes and goes with what is open.
							settings={null}
							open={open}
							onOpen={onOpen}
						/>
						{/* At its foot, as at the sidebar's beside it. */}
						<div className="border-t pt-3">
							<ConversationActions
								feed={feed}
								drafts={drafts}
								tasks={tasks}
								open={open}
								onOpen={onOpen}
							/>
						</div>
					</>
				) : startsOne(open) || (open === null && !phone) ? (
					<Home
						// Its picks are for one agent's settings, and its draft for one
						// tree, so start over for another.
						key={`${agentFor(open, agents, conversations)}/${taskFor(open)}/${modelFor(open)}`}
						drafts={drafts}
						tasks={tasks}
						feed={feed}
						agents={agents}
						agent={agentFor(open, agents, conversations)}
						task={taskFor(open)}
						model={modelFor(open)}
						conversations={conversations}
						refuseIn={refuse}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				) : open !== null && isMain(open) ? (
					<MainTerminal
						key={open}
						terminals={terminals}
						terminal={open}
						trunk={trunk}
						onBack={phone ? () => onOpen(null) : null}
						onExit={() => onOpen(NEW)}
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
							agents={agents}
							drafts={drafts}
							onBrought={(state) => {
								feed.put(state);
								onOpen(state.id);
							}}
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
						tasks={tasks}
						free={free}
						trunk={trunk}
						refusal={refusals.get(shown.id) ?? null}
						refuseIn={refuse}
						onArchived={() => onOpen(NEW)}
						onLeft={() => {
							const waiting = nextWaiting(
								rowsOf(tasks, conversations),
								drafts,
								open,
							);
							if (waiting === undefined || openedBy(waiting) === open) {
								onOpen(NEW);
							} else {
								arriveAt(openedBy(waiting));
								onOpen(openedBy(waiting));
							}
						}}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				)}
			</div>
			<TodoDialog todo={todo} onClose={() => setOpenedTodo(null)} />
			<Dialog
				open={task !== undefined}
				onOpenChange={(open) => open || setOpenedTask(null)}
			>
				{task && <Task task={task} />}
			</Dialog>
		</Board>
	);
}

/**
 * Marks `conversation` read while it shows on a page in front: once it is
 * opened, and again as each turn ends while you watch.
 */
function useRead(conversation: ConversationState | null): void {
	const [inFront, setInFront] = useState(true);
	useEffect(() => {
		const observer = new WindowBackgroundObserver();
		const check = () => setInFront(!observer.isBackgrounded());
		check();
		observer.events.on("change", check);
		return () => observer.dispose();
	}, []);
	const id = conversation?.id ?? null;
	const unread = conversation?.unread ?? false;
	useEffect(() => {
		if (id !== null && unread && inFront) {
			// Nothing to tell anyone: the dot stays until the next try.
			markUnread(id, false).catch(() => {});
		}
	}, [id, unread, inFront]);
}

/** How many conversations the home screen offers to pick back up. */
const RECENT = 5;

/**
 * The screen with no conversation open: an empty thread whose first message
 * starts one with `agent` in `task`'s tree or the main tree, the agent's settings in its
 * composer, and under the greeting the latest unfinished conversations to
 * pick back up, none whose task merged.
 */
function Home({
	drafts,
	tasks,
	feed,
	agents,
	agent,
	task,
	model,
	conversations,
	refuseIn,
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
	/** The task whose tree it starts in; null for the main tree. */
	task: string | null;
	/** The model it starts on, by its id on the roster; null for as picked. */
	model: string | null;
	/** Every one, archived too, newest first. */
	conversations: ConversationState[];
	/** Says in a conversation's thread that a write to it was refused. */
	refuseIn: (id: string, title: string, error: unknown) => void;
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { refusal, refuse } = useRefusal();
	// What the agent's sessions offer is known from its latest conversation
	// here that got as far as a session, archived or not, and each setting
	// starts where that one left it; failing that, from its sessions in any
	// project; the first one with an agent on this machine starts with the
	// agent's own defaults.
	const offered =
		conversations.find(
			(each) => each.agent === agent && each.settings.length > 0,
		)?.settings ??
		agents.find((each) => each.id === agent)?.settings ??
		[];
	// A model asked for, as by a todo's agent, shows picked where it is offered.
	const [picks, setPicks] = useState<Record<string, string>>(() => {
		const asked = model === null ? null : modelOption(offered, model);
		return asked === null ? {} : { [asked.setting]: asked.value };
	});
	const listed = conversations.filter((each) => !each.archived);
	const [starting, setStarting] = useState(false);
	const restore = useRef<(text: string, images: File[]) => void>(() => {});
	// Only unfinished work at rest: one at work or waiting on the person is in
	// the sidebar already, and one whose task merged is done.
	const recent = listed
		.filter(
			(each) =>
				needOf(tasks, each).kind === "idle" && reportedAs(each) !== "merged",
		)
		.slice(0, RECENT);
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		isRunning: starting,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters: { attachments: IMAGES },
		onNew: async (message) => {
			const text = said(message);
			const images = imagesOf(message);
			setStarting(true);
			// Each as shown: where it was left, unless picked here.
			const settings = {
				...Object.fromEntries(offered.map((each) => [each.id, each.current])),
				...picks,
			};
			const state = await startConversation(
				agent,
				task,
				settings,
				// Until a session has offered its settings, the server picks it.
				model !== null && offered.length === 0 ? model : undefined,
			).catch((error: unknown) => {
				setStarting(false);
				restore.current(text, images);
				refuse("Not started", error);
				throw error;
			});
			feed.put(state);
			// Shown at once in its thread, so the person watches the agent come
			// up; the message waits on the server for the session to open.
			const sending =
				text !== "" || images.length > 0
					? feed.send(state.id, noted(text, images), images)
					: null;
			onOpen(state.id);
			await promptConversation(state.id, noted(text, images), images).catch(
				(error: unknown) => {
					// The conversation is open by now: what was not sent waits in its
					// composer, its words only.
					if (sending !== null) {
						feed.sent(state.id, sending);
					}
					drafts.write(state.id, text);
					refuseIn(state.id, "Not sent", error);
				},
			);
		},
	});
	restore.current = useDraft(
		runtime,
		drafts,
		newDraft(new URLSearchParams(location.search).get("project"), task),
	);
	const mentions = useFileMentions(task);
	const references = useReferences(runtime.thread.composer, tasks);

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
				<Composing.Provider value={runtime.thread.composer}>
					<ThreadView
						mentions={mentions ?? undefined}
						references={references}
						above={<Refusal refusal={refusal} className="px-2" />}
						welcome={
							<div className="mb-6 flex flex-col gap-8 px-2">
								<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-2xl tracking-tight duration-200">
									<span>Start a conversation with</span>
									<AgentBrand agent={agent} name={agentName(agents, agent)} />
									{task !== null && (
										<span>
											in <span className="font-mono text-xl">{task}</span>
										</span>
									)}
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
						controls={
							offered.length > 0 ? (
								offered.map((setting) => (
									<SettingControl
										key={setting.id}
										setting={setting}
										value={picks[setting.id] ?? setting.current}
										onChange={(value) =>
											setPicks((picks) => ({ ...picks, [setting.id]: value }))
										}
									/>
								))
							) : (
								<span className="px-1.5 text-[11px] text-muted-foreground">
									Settings appear once {agentName(agents, agent)} starts
								</span>
							)
						}
					/>
				</Composing.Provider>
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

/** The categories of setting a picker shows by value alone, effort among them. */
const UNLABELED = new Set(["mode", "model", "thought_level"]);

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
				{/* A mode, model, or effort says what it is by its value; "Off"
				    alone would not. */}
				{!UNLABELED.has(setting.category ?? "") && (
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
	const trunk = useContext(Trunk);
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
			{whereOf(conversation, trunk) !== null && (
				<span className="shrink-0 truncate text-muted-foreground text-xs">
					{whereOf(conversation, trunk)}
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
	pending,
	onEdit,
	onDiscard,
	onSendNow,
}: {
	conversation: string;
	messages: Message[];
	/** How many of `messages`, the last ones, the server has yet to record. */
	pending: number;
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
					const { directives, rest } = leadingDirectives(text);
					const label =
						text ||
						(images.length === 1 ? "an image" : `${images.length} images`);
					// Still on its way while the agent starts: the server has nothing
					// to take back yet.
					const unrecorded = index >= messages.length - pending;
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
							{directives.map((directive) => (
								<DirectiveChip key={directive} directive={directive} />
							))}
							<span className="min-w-0 flex-1 truncate text-sm">{rest}</span>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Edit ${label}`}
								disabled={unrecorded}
								onClick={() => onEdit(index)}
							>
								<PencilIcon />
							</Button>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Discard ${label}`}
								disabled={unrecorded}
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

/**
 * The archived conversations, newest first, to read or bring back: every one
 * kept, since arbor deletes the older ones.
 */
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
				<p className="text-muted-foreground text-sm">Nothing archived.</p>
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
			if (kept !== "" && composer.getState().isEmpty) {
				composer.setText(kept);
			}
		};
		// Kept with its directives as text, ahead of what is typed.
		const unsubscribe = composer.subscribe(() => {
			const { text, attachments } = composer.getState();
			if (leadingDirectives(text).directives.length > 0) {
				// Each change it makes comes back here, to be kept.
				liftDirectives(composer);
				return;
			}
			drafts.write(key, withDirectives(directivesOf(attachments), text));
		});
		fill();
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
 * What `message` says, its directives ahead of its words; its images go
 * apart.
 */
function said(message: AppendMessage): string {
	const text = message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
	return withDirectives(directivesOf(message.attachments ?? []), text);
}

/**
 * `text` as the agent is sent it: then the notes on the marks drawn on
 * `images`, which it reads beside the numbers drawn in. A message that comes
 * back to the composer unsent comes back as `text`, its images still marked
 * up, so the notes are not said twice.
 */
function noted(text: string, images: readonly File[]): string {
	return [text, Annotation.notesFor(images)]
		.filter((each) => each !== "")
		.join("\n\n");
}

/**
 * The images the agent can be sent, held as files until the message goes:
 * PNG, JPEG, GIF and WebP, the ones the server keeps.
 */
class ImageAttachments extends SimpleImageAttachmentAdapter {
	// Directives too, which are text only and never come from a file.
	override accept =
		`image/png,image/jpeg,image/gif,image/webp,${DIRECTIVE_TYPE}`;
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
			send: (said: string) => promptConversation(id, said),
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
 * with what the agent is asking above its composer. ⌥⌘⌫ (Ctrl+Alt+Backspace
 * off a Mac) archives it; only Unarchive brings it back.
 */
function Thread({
	drafts,
	conversation,
	feed,
	agent,
	task,
	tasks,
	free,
	trunk,
	refusal,
	refuseIn,
	onArchived,
	onLeft,
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
	/** Every live task, for `#` to offer. */
	tasks: Details[];
	/** The tasks it can take up from the main tree. */
	free: Details[];
	/** The main tree's branch. */
	trunk: string;
	/** A write to it the server refused, said above the composer for a moment. */
	refusal: string | null;
	refuseIn: (id: string, title: string, error: unknown) => void;
	/** Once a report card has archived it, to start the next. */
	onArchived: () => void;
	/**
	 * Once ⌥⌘⌫ has archived it, to go on to the next agent waiting on you, or
	 * a new conversation with none.
	 */
	onLeft: () => void;
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { id, status, settings, archived } = conversation;
	const refused = useCallback(
		(title: string, error: unknown) => refuseIn(id, title, error),
		[refuseIn, id],
	);
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
	// Its last word asks questions, escalates, or asks for a review, or it
	// asks as it works: the card takes the focus, not the composer, unless it
	// holds a draft, nor the open questions' dialog.
	const last = messages.at(-1);
	const asking =
		conversation.ask !== null ||
		(last?.role === "assistant" &&
			typeof last.content !== "string" &&
			last.content.some(
				(part) =>
					part.type === "data-questions" ||
					part.type === "data-review" ||
					(part.type === "data-report" &&
						(part.data as { report: Report }).report.ending === "escalated"),
			));
	const restore = useRef<(text: string, images: File[]) => void>(() => {});
	const send = useCallback(
		async (text: string, images: File[]) => {
			// The server says nothing of it until the agent is back up.
			const sending =
				status !== "idle" &&
				status !== "running" &&
				(text !== "" || images.length > 0)
					? feed.send(id, noted(text, images), images)
					: null;
			await promptConversation(id, noted(text, images), images).catch(
				(error: unknown) => {
					if (sending !== null) {
						feed.sent(id, sending);
					}
					restore.current(text, images);
					refused("Not sent", error);
					throw error;
				},
			);
		},
		[id, status, feed, refused],
	);
	const say = useCallback(
		(message: AppendMessage) => send(said(message), imagesOf(message)),
		[send],
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
	const archive = useArchive(conversation, refused);
	const [details, setDetails] = useState(false);
	const needed = need(task, conversation);
	// Those the person answered and the agent has yet to record wait on nobody.
	const open = unanswered(
		openQuestions(needed),
		conversation.messages,
		writing,
	);
	// Opened from the first render on ⌥⌘M, so the composer leaves them the
	// focus. Never while a card asks, which goes first, though one that comes
	// once they are open leaves them open.
	const [answering, setAnswering] = useState(
		() => arriving(id) && open.uncarded.length > 0 && !archived && !asking,
	);
	// The card the thread asks through first, then those no card asks, apart
	// from the conversation, then any other card it waits on you through.
	const toAsked = () => {
		if (asking) {
			return toWaiting(section.current);
		}
		if (open.uncarded.length > 0 && !archived) {
			setAnswering(true);
			return true;
		}
		return toWaiting(section.current);
	};
	useArrived(id, toAsked);
	// With none open, the plan.
	const toQuestions = () => toAsked() || setDetails(task !== null);
	const actions: Action[] = [
		questionsAction(
			"questions" in needed
				? { ...needed, questions: open.unanswered }
				: needed,
			toQuestions,
		),
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
			icon: archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />,
			detail: archived ? undefined : <Kbd>{ARCHIVE}</Kbd>,
			run: () => archive.file(),
		},
	];
	const references = useReferences(runtime.thread.composer, tasks, actions);
	// Archived, on to the next. Already archived, the key does nothing.
	const fileByKey = () => {
		if (!archived) {
			archive.file(onLeft);
		}
	};
	// The latest, for the listener below, which outlives a render.
	const fileRef = useRef(fileByKey);
	fileRef.current = fileByKey;
	useEffect(() => {
		// By the key's place, as ⌥⌘N and ⌥⌘M.
		const file = (event: KeyboardEvent) => {
			if (
				event.code === "Backspace" &&
				event.altKey &&
				(event.metaKey || event.ctrlKey)
			) {
				event.preventDefault();
				fileRef.current();
			}
		};
		document.addEventListener("keydown", file);
		return () => document.removeEventListener("keydown", file);
	}, []);
	// The latest, so the card's callback stays the same across renders.
	const onArchivedRef = useRef(onArchived);
	onArchivedRef.current = onArchived;
	const filing = useMemo(
		() => ({
			archived,
			// With the agent, model, and settings the last one started with.
			archive: () =>
				archiveConversation(id, true).then(() => onArchivedRef.current()),
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
	const branch = task?.branch ?? (conversation.task === null ? trunk : null);
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
					queued.length > 0 &&
					// The last one is still on its way, with nothing to take back.
					feed.unrecorded(id) === 0
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
							refuse={refused}
							onDone={() => setRenaming(false)}
						/>
					) : (
						// A shortcut: the menu in the sidebar renames too. Capped, so a
						// long name, such as a question it was named after, ends in an
						// ellipsis rather than running across the pane.
						<div className="flex min-w-0 items-center gap-2">
							<h2
								onDoubleClick={() => setRenaming(true)}
								title={`${nameOf(conversation)}\nDouble-click to rename`}
								className={cn(
									"max-w-md truncate font-medium text-sm",
									unnamed(conversation) && "text-muted-foreground italic",
								)}
							>
								{nameOf(conversation)}
							</h2>
							{task !== null && <TaskStatus task={task} />}
						</div>
					)}
					{conversation.task === null && !archived ? (
						<TakeUp
							trunk={trunk}
							tasks={free}
							onTake={(text) => void send(text, []).catch(() => {})}
						/>
					) : (
						<TaskLine
							branch={branch}
							task={task}
							onDetails={() => setDetails(true)}
						/>
					)}
				</div>
				<ActionButtons actions={actions} />
			</header>
			{archive.confirm}
			{task !== null && (
				<Dialog open={details} onOpenChange={setDetails}>
					{details && <Task task={task} />}
				</Dialog>
			)}
			{task !== null && (
				// Once open, it keeps the questions it opened on, those a card
				// that comes since asks among them, until they are answered.
				<Dialog
					open={answering && open.unanswered.length > 0}
					onOpenChange={setAnswering}
				>
					{answering && (
						<ReplyContext value={reply}>
							<OpenQuestions
								task={task.task}
								questions={open.unanswered}
								onSent={() => setAnswering(false)}
							/>
						</ReplyContext>
					)}
				</Dialog>
			)}
			{conversation.error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{conversation.error}
				</p>
			)}
			<div className="relative min-h-0 flex-1">
				<AssistantRuntimeProvider runtime={runtime}>
					<Composing.Provider value={runtime.thread.composer}>
						<QuestionsUI />
						<ReviewUI />
						<ReportUI />
						<TodoUI />
						<WorkUI />
						<ArchiveContext value={filing}>
							<StartNewContext value={startNew}>
								<ReplyContext value={reply}>
									<ThreadView
										autoFocus={!(asking || answering) || typed}
										mentions={mentions ?? undefined}
										references={references}
										placeholder={
											archived ? "Archived: unarchive to continue" : undefined
										}
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
												<Refusal refusal={refusal} className="px-2" />
												{queued.length > 0 && (
													<Queued
														conversation={id}
														messages={queued}
														pending={feed.unrecorded(id)}
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
					</Composing.Provider>
				</AssistantRuntimeProvider>
				<Actions actions={actions} />
			</div>
		</section>
	);
}

/**
 * Whether ⌥⌘M stops on `row`: an agent stopped on you, or one asking as it
 * works, while it has questions no reply has answered yet, nor for an
 * external agent, copied.
 */
function waitsOnYou(
	{ conversation, task, need }: Needing,
	drafts: Drafts,
): boolean {
	if (copiedFor(drafts, conversation, task, need)) {
		return false;
	}
	if (need.kind === "waiting" && need.why !== "questions") {
		return true;
	}
	if (need.kind !== "waiting" && need.kind !== "assuming") {
		return false;
	}
	const running =
		conversation?.status === "running" || conversation?.status === "starting";
	return (
		unanswered(need.questions, conversation?.messages ?? [], running).unanswered
			.length > 0
	);
}

/**
 * Open questions in the task's `## Blocked` that no card in the thread asks,
 * as one put while the agent works on a guess, or left once the person
 * answered the rest: answered in a dialog, apart from the conversation, by
 * their numbers there.
 */
function OpenQuestions({
	task,
	questions,
	onSent,
}: {
	task: string;
	questions: Asked[];
	onSent: () => void;
}): JSX.Element {
	return (
		<DialogContent className="max-h-[85dvh] grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-xl">
			<DialogHeader>
				<DialogTitle>Open questions</DialogTitle>
				<DialogDescription>
					In {task}'s plan, not yet asked in the conversation.
				</DialogDescription>
			</DialogHeader>
			<QuestionCards
				// Afresh as the questions change, so answers sent go with them.
				key={questions.map((asked) => asked.number).join(",")}
				questions={questions}
				draft="questions:blocked"
				blocked
				onSent={onSent}
			/>
		</DialogContent>
	);
}

/**
 * The line under a main-tree conversation's title: the trunk's branch, which
 * opens a menu of the tasks and open todos its agent can take up. Picking one
 * asks the agent to claim it, and the conversation follows it there.
 */
function TakeUp({
	trunk,
	tasks,
	onTake,
}: {
	trunk: string;
	tasks: Details[];
	/** Sends the prompt that takes it up. */
	onTake: (text: string) => void;
}): JSX.Element {
	const board = useContext(Board);
	const todos = board.todos
		.filter((each) => each.takenBy === null)
		.sort((one, other) => one.position - other.position);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						aria-label="Take up a task or todo"
						title="Take up a task or todo"
						className="flex min-w-0 items-center gap-1 self-start rounded-sm text-muted-foreground text-xs hover:text-foreground"
					>
						<GitBranchIcon
							role="img"
							aria-label="branch"
							className="size-3 shrink-0"
						/>
						<span className="truncate">{trunk}</span>
						<ChevronDownIcon aria-hidden className="size-3 shrink-0" />
					</button>
				}
			/>
			<DropdownMenuContent className="max-h-80 w-80 overflow-y-auto">
				{tasks.length === 0 && todos.length === 0 && (
					<p className="px-1.5 py-1 text-muted-foreground text-xs">
						No task or open todo to take up.
					</p>
				)}
				{tasks.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Claim a task</DropdownMenuLabel>
						{tasks.map((each) => (
							<DropdownMenuItem
								key={each.task}
								onClick={() => onTake(taskReference(each.task))}
							>
								<GitBranchIcon aria-hidden />
								<span className="truncate">{each.task}</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				)}
				{tasks.length > 0 && todos.length > 0 && <DropdownMenuSeparator />}
				{todos.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Start a todo</DropdownMenuLabel>
						{todos.map((each) => (
							<DropdownMenuItem
								key={each.id}
								onClick={() => onTake(todoReference(each.id))}
							>
								<ListTodoIcon aria-hidden />
								<span className="min-w-0 flex-1 truncate">{each.subject}</span>
								<span className="shrink-0 text-muted-foreground tabular-nums">
									#{each.id}
								</span>
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
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
	// Once the turn is over, the last thing it said, even with tool calls
	// after it, since a turn that ends on one would otherwise fold its words
	// away. While it goes on, only words still coming: what it said before
	// its latest call or thought is narration, kept in the timeline.
	const said = message.parts.findLastIndex(
		(part, index) =>
			part.type === "text" &&
			part.text.trim() !== "" &&
			(settled || index === message.parts.length - 1),
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
 * writing them: a list mid-stream may yet turn out not to ask any. An
 * escalation's questions come right after it, so the two are one card: the
 * questions, headed as the escalation.
 */
function replied(text: string, settled: boolean): LikePart[] {
	if (!settled) {
		return [{ type: "text", text }];
	}
	const all = stretches(text);
	return all.flatMap((stretch, at): LikePart[] => {
		const before = all[at - 1];
		const after = all[at + 1];
		switch (stretch.type) {
			case "text":
				return [{ type: "text", text: stretch.text }];
			case "questions":
				return [
					{
						type: "data-questions",
						data: {
							questions: stretch.questions,
							escalation:
								before?.type === "report" &&
								before.report.ending === "escalated"
									? before.report
									: null,
						},
					},
				];
			case "review":
				return [{ type: "data-review", data: { review: stretch.review } }];
			case "report":
				return stretch.report.ending === "escalated" &&
					after?.type === "questions"
					? []
					: [{ type: "data-report", data: { report: stretch.report } }];
			case "todo":
				return [{ type: "data-todo", data: { todo: stretch.todo } }];
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
	const { refusal, refuse } = useRefusal();
	const send = (answer: Answer) =>
		answerConversation(conversation.id, ask.id, answer).then(
			() => drafts.write(key, ""),
			(error: unknown) => refuse("Not answered", error),
		);
	return (
		<>
			{ask.type === "permission" ? (
				<Permission
					ask={ask}
					command={commandOf(conversation, ask.id)}
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
			)}
			<Refusal refusal={refusal} className="-mt-2 px-2" />
		</>
	);
}

/** The command the tool call `id` runs, for one that runs one. */
function commandOf(conversation: ConversationState, id: string): string | null {
	for (const message of conversation.messages) {
		for (const part of message.parts) {
			if (part.type === "tool" && part.id === id) {
				return part.command;
			}
		}
	}
	return null;
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
	command,
	agent,
	where,
	send,
}: {
	ask: Extract<Ask, { type: "permission" }>;
	command: string | null;
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
			command={command}
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

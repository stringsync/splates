import {
	type AppendMessage,
	type AssistantRuntime,
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	type TriggerAdapter,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	EllipsisVerticalIcon,
	FileDiffIcon,
	LinkIcon,
	Loader2Icon,
	PencilIcon,
	PlusIcon,
	SendHorizontalIcon,
	SquareArrowOutUpRightIcon,
	SquareTerminalIcon,
} from "lucide-react";
import {
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { PermissionGrant } from "#dev/components/assistant-ui/elements/permission-grant.tsx";
import { QuestionFlow } from "#dev/components/assistant-ui/elements/question-flow.tsx";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Badge } from "#dev/components/ui/badge.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
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
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import { stretches } from "../asked";
import type {
	Answer,
	Ask,
	ConversationState,
	Message,
	Setting,
	Status,
} from "../conversations";
import { type Need, type Needing, need, needs } from "../needs";
import type { Details } from "../show";
import { AgentIcon } from "./agent-icons";
import {
	answerConversation,
	archiveConversation,
	cancelConversation,
	chooseSetting,
	paths,
	promptConversation,
	renameConversation,
	sendQueuedNow,
	startConversation,
	unqueueConversation,
} from "./api";
import { Back } from "./back";
import { ReviewChanges } from "./changes";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { Drafts, newDraft } from "./drafts";
import { rank } from "./mentions";
import { type Action, Overview, OverviewButtons } from "./overview";
import {
	QuestionsUI,
	type Reply,
	ReplyContext,
	ReviewUI,
} from "./question-cards";
import { TASK, TaskLine, TaskView } from "./task-view";
import { Task } from "./tasks";
import { ToggleTerminal } from "./terminal";
import { TOGGLE } from "./terminal-session";
import type { Work } from "./work";
import { WorkUI } from "./work-row";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";
/** In place of an id in the address: the screen that starts a conversation. */
export const NEW = "new";

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
 * title.
 */
function nameOf(conversation: ConversationState): string {
	return (
		conversation.name ??
		conversation.task ??
		conversation.title ??
		"New conversation"
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
 * The arrow keys move between rows, and Alt+N opens the next one waiting.
 */
export function ConversationList({
	feed,
	tasks,
	open,
	onOpen,
}: {
	feed: ConversationFeed;
	tasks: Details[];
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
			if (event.altKey && event.code === "KeyN") {
				event.preventDefault();
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
			<button
				type="button"
				data-row
				aria-current={open === NEW ? "page" : undefined}
				onClick={() => onOpen(NEW)}
				className={cn(
					"flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm hover:bg-foreground/[0.05]",
					open === NEW && "bg-foreground/[0.09]",
				)}
			>
				<PlusIcon className="size-3.5" />
				New conversation
			</button>
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
				current && "bg-foreground/[0.09] hover:bg-foreground/[0.09]",
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
	const { id, archived } = conversation;
	const file = () =>
		archiveConversation(id, !archived).catch((error: unknown) =>
			refused(archived ? "Not unarchived" : "Not archived", error),
		);
	const Put = archived ? ArchiveRestoreIcon : ArchiveIcon;
	const put = archived ? "Unarchive" : "Archive";
	return (
		<div
			className={cn(
				"group/item relative flex items-center rounded-md text-foreground hover:bg-foreground/[0.05]",
				current && "bg-foreground/[0.09] hover:bg-foreground/[0.09]",
			)}
		>
			{renaming && (
				<Rename conversation={conversation} onDone={() => setRenaming(false)} />
			)}
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
					menu ? "pr-14" : need.kind === "idle" ? "pr-3" : "pr-6",
				)}
			>
				<AgentIcon
					agent={conversation.agent}
					name={agent}
					className="size-3.5 text-foreground/70"
				/>
				<span className="min-w-0 flex-1 truncate text-sm">
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
				<Mark need={need} />
			</span>
			<span
				className={cn(
					"absolute right-1 flex items-center",
					renaming && "hidden",
					!menu &&
						"opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 pointer-coarse:opacity-100",
				)}
			>
				<Button
					size="icon-xs"
					variant="ghost"
					aria-label={`${put} ${nameOf(conversation)}`}
					onClick={() => void file()}
				>
					<Put />
				</Button>
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
							onClick={() =>
								void navigator.clipboard.writeText(
									`${location.origin}${location.pathname}#conversations/${id}`,
								)
							}
						>
							<LinkIcon />
							Copy link
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setRenaming(true)}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void file()}>
							<Put />
							{put}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
		</div>
	);
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
	const [value, setValue] = useState(nameOf(conversation));
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
 * it works, assuming or not, and an empty space when idle. What it waits on is in its
 * tooltip. Each sits centered in a box of one size, so marks line up down a
 * list whichever kind they are.
 */
function Mark({ need }: { need: Need }): JSX.Element {
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
	trunk,
	open,
	onOpen,
	phone,
}: {
	feed: ConversationFeed;
	tasks: Details[];
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

	return (
		<div className="flex flex-col gap-4">
			{phone && open === null ? (
				<ConversationList
					feed={feed}
					tasks={tasks}
					open={open}
					onOpen={onOpen}
				/>
			) : open === NEW || (open === null && !phone) ? (
				<Home
					drafts={drafts}
					tasks={tasks}
					feed={feed}
					agents={agents}
					conversations={conversations.filter((each) => !each.archived)}
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
					agent={agentName(agents, shown.agent)}
					task={tasks.find((each) => each.task === shown.task) ?? null}
					trunk={trunk}
					onBack={phone ? () => onOpen(null) : null}
				/>
			)}
		</div>
	);
}

/** How many conversations the home screen offers to pick back up. */
const RECENT = 5;

/**
 * The screen with no conversation open: an empty thread whose first message
 * starts one in the main tree, with the agent picked by its composer, and
 * under the greeting the latest conversations to pick back up, those waiting
 * on the person first.
 */
function Home({
	drafts,
	tasks,
	feed,
	agents,
	conversations,
	onOpen,
	onBack,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	tasks: Details[];
	feed: ConversationFeed;
	agents: AgentChoice[];
	/** The ones not archived, newest first. */
	conversations: ConversationState[];
	onOpen: (id: string) => void;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const [agent, setAgent] = useState(agents[0]?.id ?? "");
	// What the agent's sessions offer is known from its latest conversation
	// that got as far as a session; the first one with an agent starts with
	// the agent's own defaults.
	const offered =
		conversations.find(
			(each) => each.agent === agent && each.settings.length > 0,
		)?.settings ?? [];
	const [picks, setPicks] = useState<Record<string, string>>({});
	const [starting, setStarting] = useState(false);
	const restore = useRef<(text: string) => void>(() => {});
	const waiting = (each: ConversationState) =>
		needOf(tasks, each).kind === "waiting";
	const recent = [
		...conversations.filter(waiting),
		...conversations.filter((each) => !waiting(each)),
	].slice(0, RECENT);
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		isRunning: starting,
		convertMessage: (message: ThreadMessageLike) => message,
		onNew: async (message) => {
			const text = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			setStarting(true);
			const state = await startConversation(agent, null, picks).catch(
				(error: unknown) => {
					setStarting(false);
					restore.current(text);
					refused("Not started", error);
					throw error;
				},
			);
			feed.put(state);
			// Shown at once, so the person watches the agent come up; the message
			// waits on the server for the session to open.
			onOpen(state.id);
			await promptConversation(state.id, text).catch((error: unknown) => {
				// The conversation is open by now: what was not sent waits in its
				// composer.
				drafts.write(state.id, text);
				refused("Not sent", error);
			});
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
							<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex flex-wrap items-center gap-1 font-medium text-2xl tracking-tight duration-200">
								<span>Start a conversation with</span>
								<Select
									items={agents.map((each) => ({
										value: each.id,
										label: each.name,
									}))}
									value={agent}
									onValueChange={(value) => {
										setAgent(String(value));
										setPicks({});
									}}
								>
									<SelectTrigger
										size="sm"
										aria-label="agent"
										className="h-auto gap-2 rounded-lg border-foreground/20 bg-muted px-3 py-1 font-medium text-2xl tracking-tight shadow-xs hover:bg-foreground/10 dark:bg-muted dark:hover:bg-foreground/15 [&_svg]:size-5"
									>
										<AgentIcon
											agent={agent}
											name={agentName(agents, agent)}
											className="size-5"
										/>
										<SelectValue />
									</SelectTrigger>
									<SelectContent
										align="start"
										alignItemWithTrigger={false}
										className="w-auto"
									>
										{agents.map((each) => (
											<SelectItem key={each.id} value={each.id}>
												<AgentIcon
													agent={each.id}
													name={each.name}
													className="size-3.5"
												/>
												{each.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
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
													need={needOf(tasks, each)}
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
						<SettingSelect
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

/** A conversation to pick back up: its mark, name, where it runs, its state. */
function Recent({
	conversation,
	agent,
	need,
	onOpen,
}: {
	conversation: ConversationState;
	agent: string;
	need: Need;
	onOpen: () => void;
}): JSX.Element {
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
			<span className="min-w-0 flex-1 truncate text-sm">
				{nameOf(conversation)}
			</span>
			{whereOf(conversation) !== null && (
				<span className="shrink-0 truncate text-muted-foreground text-xs">
					{whereOf(conversation)}
				</span>
			)}
			<Mark need={need} />
		</button>
	);
}

/**
 * What the person said while the agent worked, to an agent that cannot take
 * it mid-turn, until the turn ends and it goes out: each one can be taken
 * back to edit, and all of them sent now, which stops the turn.
 */
function Queued({
	messages,
	onEdit,
	onSendNow,
}: {
	messages: Message[];
	onEdit: (index: number) => void;
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
					return (
						<li
							// Only ever added at the end and taken from anywhere, but
							// each one's words are what the person sees.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={index}
							className="group/queued flex items-center gap-2 rounded-lg py-1 pr-1 pl-2 hover:bg-foreground/[0.04]"
						>
							<span className="min-w-0 flex-1 truncate text-sm">{text}</span>
							<Button
								size="icon-xs"
								variant="ghost"
								aria-label={`Edit ${text}`}
								onClick={() => onEdit(index)}
							>
								<PencilIcon />
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
): (text: string) => void {
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
	return (text) => {
		// Typed again since it was sent: that is the newer draft.
		if (runtime.thread.composer.getState().text === "") {
			runtime.thread.composer.setText(text);
		}
	};
}

/**
 * `runtime`'s composer as the question cards write to it: its text, kept
 * current as it is typed in, and the textarea in `within` to focus.
 */
function useReply(
	runtime: AssistantRuntime,
	within: { current: HTMLElement | null },
): Reply {
	const composer = runtime.thread.composer;
	const [text, setText] = useState(() => composer.getState().text);
	useEffect(
		() => composer.subscribe(() => setText(composer.getState().text)),
		[composer],
	);
	return useMemo(
		() => ({
			text,
			write: (next: string) => composer.setText(next),
			focus: () => {
				const box = within.current?.querySelector("textarea");
				box?.focus();
				box?.setSelectionRange(box.value.length, box.value.length);
			},
		}),
		[text, composer, within],
	);
}

/**
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer.
 */
function Thread({
	drafts,
	conversation,
	agent,
	task,
	trunk,
	onBack,
}: {
	/** What was typed and not sent, by conversation. */
	drafts: Drafts;
	conversation: ConversationState;
	/** The agent's name. */
	agent: string;
	/** The task it runs in; null in the main tree, or once the task is gone. */
	task: Details | null;
	/** The main tree's branch. */
	trunk: string;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { id, status, settings, archived } = conversation;
	const running = status === "running";
	// The last message is still being written while the agent works.
	const writing = status === "running" || status === "starting";
	// What waits for the turn's end sits above the composer, not in the
	// thread: the agent has yet to hear it, and the thread would take it for
	// a turn the agent is answering.
	const queued = conversation.messages.filter((each) => each.queued);
	const messages = useMemo(() => {
		const said = conversation.messages.filter((each) => !each.queued);
		return said.map((message, index) =>
			like(
				message,
				index,
				!writing || index < said.length - 1,
				said[index - 1]?.at ?? message.at,
			),
		);
	}, [conversation.messages, writing]);
	const restore = useRef<(text: string) => void>(() => {});
	const say = useCallback(
		async (message: AppendMessage) => {
			const text = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			await promptConversation(id, text).catch((error: unknown) => {
				restore.current(text);
				refused("Not sent", error);
				throw error;
			});
		},
		[id],
	);
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		// A stopped conversation takes a prompt, which resumes it, and one
		// still starting holds it until the session opens.
		isDisabled: archived,
		convertMessage: (message: ThreadMessageLike) => message,
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
	const reply = useReply(runtime, section);
	const mentions = useFileMentions(conversation.task);
	const [renaming, setRenaming] = useState(false);
	// Stops the turn so what is queued goes out now.
	const sendNow = () =>
		sendQueuedNow(id).catch((error: unknown) => refused("Not sent", error));
	// Back into the composer to edit, ahead of anything typed there since.
	const edit = async (index: number) => {
		const text = await unqueueConversation(id, index).catch(
			(error: unknown) => {
				refused("Not taken back", error);
				return null;
			},
		);
		if (text === null) {
			return;
		}
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(typed === "" ? text : `${text}\n\n${typed}`);
		section.current
			?.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="Message input"]',
			)
			?.focus();
	};
	const review = useContext(ReviewChanges);
	const terminal = useContext(ToggleTerminal);
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
			run: () => {
				archiveConversation(id, !archived).catch((error: unknown) =>
					refused(archived ? "Not unarchived" : "Not archived", error),
				);
			},
		},
	];
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
							className="truncate font-medium text-sm"
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
					<WorkUI />
					<ReplyContext value={reply}>
						<ThreadView
							mentions={mentions ?? undefined}
							controls={
								!archived &&
								settings.map((setting) => (
									<SettingSelect
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
											messages={queued}
											onEdit={(index) => void edit(index)}
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
				</AssistantRuntimeProvider>
			</div>
		</section>
	);
}

/** One part of a message as assistant-ui takes it. */
type LikePart = Exclude<ThreadMessageLike["content"], string>[number];

/**
 * A message as assistant-ui takes one, the one place ACP's shape meets
 * assistant-ui's. An agent's turn is its reply, the text it ends on, after
 * one `data-work` part holding everything it did on the way there.
 */
function like(
	message: Message,
	index: number,
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
		};
	}
	const last = message.parts.at(-1);
	const reply = last?.type === "text" ? last.text : "";
	const parts = reply === "" ? message.parts : message.parts.slice(0, -1);
	const work: Work = {
		parts,
		plan: message.plan,
		at: began,
		until: message.until,
		running: !settled,
	};
	return {
		id,
		role: "assistant",
		content: [
			...(parts.length > 0 || message.plan !== null
				? [{ type: "data-work" as const, data: { work } }]
				: []),
			...(reply === "" ? [] : replied(reply, settled)),
		],
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

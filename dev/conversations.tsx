import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	type TriggerAdapter,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ChevronLeftIcon,
	EllipsisVerticalIcon,
	LinkIcon,
	PencilIcon,
	PlusIcon,
} from "lucide-react";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { PermissionGrant } from "#dev/components/assistant-ui/elements/permission-grant.tsx";
import { QuestionFlow } from "#dev/components/assistant-ui/elements/question-flow.tsx";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Badge } from "#dev/components/ui/badge.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { toast } from "#dev/components/ui/toast.tsx";
import { cn } from "#dev/lib/utils.ts";
import type {
	Answer,
	Ask,
	ConversationState,
	Message,
	Status,
} from "../conversations";
import type { Details } from "../show";
import { AgentIcon } from "./agent-icons";
import {
	answerConversation,
	archiveConversation,
	cancelConversation,
	chooseModel,
	paths,
	promptConversation,
	renameConversation,
	startConversation,
} from "./api";
import type { AgentChoice, ConversationFeed } from "./conversation-feed";
import { rank } from "./mentions";

/** What `#conversations/archived` opens: every archived conversation. */
export const ARCHIVED = "archived";

/**
 * The conversation a `#conversations/<id>` address names, `ARCHIVED` for the
 * archived ones, or null.
 */
export function conversationIn(hash: string): string | null {
	const [, id] = hash.match(/^#conversations\/(.+)$/) ?? [];
	return id ?? null;
}

/**
 * What a conversation goes by: the name the person gave it, else the agent's
 * title, else its task's name.
 */
function nameOf(conversation: ConversationState): string {
	return (
		conversation.name ??
		conversation.title ??
		conversation.task ??
		"New conversation"
	);
}

/**
 * The sidebar's conversations, grouped by the task each runs in: every live
 * task, each with a + that starts one there, then any task gone since, then
 * the main tree, last since a conversation belongs in a task. Archived ones
 * sit behind a link at the bottom.
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
	const live = tasks
		.filter((each) => each.status !== "orphaned")
		.map((each) => each.task);
	const gone = [
		...new Set(
			listed.flatMap((each) =>
				each.task !== null && !live.includes(each.task) ? [each.task] : [],
			),
		),
	];
	const groups: { task: string | null; startable: boolean }[] = [
		...live.map((task) => ({ task, startable: true })),
		...gone.map((task) => ({ task, startable: false })),
		{ task: null, startable: true },
	];
	const archived = conversations.length - listed.length;
	const start = (agent: string, task: string | null) =>
		startConversation(agent, task).then(
			(state) => {
				feed.put(state);
				onOpen(state.id);
			},
			(error: unknown) => refused("Not started", error),
		);

	return (
		<nav aria-label="conversations" className="flex flex-col gap-3">
			{groups.map(({ task, startable }) => {
				const held = listed.filter((each) => each.task === task);
				const name = task ?? "Main tree";
				return (
					<div key={task ?? ""} className="flex flex-col">
						<div className="flex items-center gap-1 pl-3">
							<h3
								className={cn(
									"min-w-0 flex-1 truncate font-medium text-muted-foreground text-xs",
									task === null && "font-normal italic",
								)}
							>
								{name}
							</h3>
							{startable && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												size="icon-xs"
												variant="ghost"
												aria-label={`New conversation in ${name}`}
											/>
										}
									>
										<PlusIcon />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="start" className="w-56">
										<DropdownMenuGroup>
											<DropdownMenuLabel>
												{task === null
													? "In the main tree, outside any task"
													: `In ${task}`}
											</DropdownMenuLabel>
											{agents.map((agent) => (
												<DropdownMenuItem
													key={agent.id}
													onClick={() => void start(agent.id, task)}
												>
													{agent.name}
												</DropdownMenuItem>
											))}
										</DropdownMenuGroup>
									</DropdownMenuContent>
								</DropdownMenu>
							)}
						</div>
						<ul aria-label={name} className="flex flex-col">
							{held.map((each) => (
								<li key={each.id}>
									<Item
										conversation={each}
										agent={agentName(agents, each.agent)}
										current={each.id === open}
										onOpen={() => onOpen(each.id)}
									/>
								</li>
							))}
						</ul>
					</div>
				);
			})}
			<button
				type="button"
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
 * One conversation in a list: its agent's mark, its name, and whether it
 * needs you. Hovered or focused, it offers Archive (or Unarchive) and a menu.
 */
function Item({
	conversation,
	agent,
	current,
	onOpen,
	where = false,
}: {
	conversation: ConversationState;
	agent: string;
	current: boolean;
	onOpen: () => void;
	/** Whether to say where it ran, for a list not grouped by task. */
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
				aria-current={current ? "page" : undefined}
				onClick={onOpen}
				onDoubleClick={() => setRenaming(true)}
				// Room for the buttons only while they show, and for a mark while
				// there is one.
				className={cn(
					// A touch screen has no hover, so its buttons always show.
					"flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left group-focus-within/item:pr-14 group-hover/item:pr-14 pointer-coarse:pr-24",
					renaming && "hidden",
					menu
						? "pr-14"
						: conversation.ask !== null || conversation.status === "failed"
							? "pr-16"
							: conversation.status === "running" ||
									conversation.status === "starting"
								? "pr-6"
								: "pr-3",
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
				{where && (
					<span className="shrink-0 truncate text-muted-foreground text-xs">
						{conversation.task ?? "main tree"}
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
				<Mark conversation={conversation} />
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

/** What a list shows of where a conversation is: only what needs a look. */
function Mark({
	conversation,
}: {
	conversation: ConversationState;
}): JSX.Element | null {
	if (conversation.ask !== null) {
		return <Badge>asking</Badge>;
	}
	if (conversation.status === "failed") {
		return <Badge variant="destructive">failed</Badge>;
	}
	if (conversation.status === "running" || conversation.status === "starting") {
		return (
			<span
				role="status"
				aria-label={conversation.status}
				className="size-1.5 animate-pulse rounded-full bg-foreground/60"
			/>
		);
	}
	return null;
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
	open,
	onOpen,
	phone,
}: {
	feed: ConversationFeed;
	tasks: Details[];
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

	return (
		<div className="flex flex-col gap-4">
			{phone && open === null ? (
				<ConversationList
					feed={feed}
					tasks={tasks}
					open={open}
					onOpen={onOpen}
				/>
			) : open === ARCHIVED ? (
				<Archived
					conversations={conversations.filter((each) => each.archived)}
					agents={agents}
					onOpen={onOpen}
					onBack={phone ? () => onOpen(null) : null}
				/>
			) : shown === null ? (
				<Home
					feed={feed}
					tasks={tasks}
					agents={agents}
					conversations={conversations.filter((each) => !each.archived)}
					onOpen={onOpen}
				/>
			) : (
				<Thread
					key={shown.id}
					conversation={shown}
					agent={agentName(agents, shown.agent)}
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
 * starts one, in the task and with the agent picked by its composer, and
 * under the greeting the latest conversations to pick back up, those waiting
 * on the person first.
 */
function Home({
	feed,
	tasks,
	agents,
	conversations,
	onOpen,
}: {
	feed: ConversationFeed;
	tasks: Details[];
	agents: AgentChoice[];
	/** The ones not archived, newest first. */
	conversations: ConversationState[];
	onOpen: (id: string) => void;
}): JSX.Element {
	const live = tasks
		.filter((each) => each.status !== "orphaned")
		.map((each) => each.task);
	const [task, setTask] = useState<string | null>(live[0] ?? null);
	const [agent, setAgent] = useState(agents[0]?.id ?? "");
	const [starting, setStarting] = useState(false);
	const waiting = (each: ConversationState) =>
		each.ask !== null || each.status === "failed";
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
			const state = await startConversation(agent, task).catch(
				(error: unknown) => {
					setStarting(false);
					refused("Not started", error);
					throw error;
				},
			);
			feed.put(state);
			// Shown at once, so the person watches the agent come up; the message
			// waits on the server for the session to open.
			onOpen(state.id);
			await promptConversation(state.id, text).catch((error: unknown) =>
				refused("Not sent", error),
			);
		},
	});
	const mentions = useFileMentions(task);

	return (
		<section
			aria-label="new conversation"
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col"
		>
			<AssistantRuntimeProvider runtime={runtime}>
				<ThreadView
					mentions={mentions ?? undefined}
					welcome={
						<div className="mb-6 flex flex-col gap-8 px-2">
							<p className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both font-medium text-2xl tracking-tight duration-200">
								Start a conversation
							</p>
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
					above={
						<div className="flex items-center gap-2 px-2 text-muted-foreground text-sm">
							<span>In</span>
							<select
								aria-label="task"
								value={task ?? ""}
								onChange={(event) =>
									setTask(event.target.value === "" ? null : event.target.value)
								}
								className={SELECT}
							>
								{live.map((each) => (
									<option key={each} value={each}>
										{each}
									</option>
								))}
								<option value="">Main tree</option>
							</select>
							<span>with</span>
							<select
								aria-label="agent"
								value={agent}
								onChange={(event) => setAgent(event.target.value)}
								className={SELECT}
							>
								{agents.map((each) => (
									<option key={each.id} value={each.id}>
										{each.name}
									</option>
								))}
							</select>
						</div>
					}
				/>
			</AssistantRuntimeProvider>
		</section>
	);
}

const NO_MESSAGES: ThreadMessageLike[] = [];

/** A conversation to pick back up: its mark, name, where it runs, its state. */
function Recent({
	conversation,
	agent,
	onOpen,
}: {
	conversation: ConversationState;
	agent: string;
	onOpen: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-3 pl-3 text-left text-foreground hover:bg-foreground/[0.05]"
		>
			<AgentIcon
				agent={conversation.agent}
				name={agent}
				className="size-3.5 text-foreground/70"
			/>
			<span className="min-w-0 flex-1 truncate text-sm">
				{nameOf(conversation)}
			</span>
			<span className="shrink-0 truncate text-muted-foreground text-xs">
				{conversation.task ?? "main tree"}
			</span>
			<Mark conversation={conversation} />
		</button>
	);
}

/** Back to the list of conversations, where there is no sidebar. */
function Back({ onBack }: { onBack: () => void }): JSX.Element {
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			aria-label="Back to conversations"
			onClick={onBack}
		>
			<ChevronLeftIcon />
		</Button>
	);
}

/** Every archived conversation, newest first, to read or bring back. */
function Archived({
	conversations,
	agents,
	onOpen,
	onBack,
}: {
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
 * One conversation: its header, then assistant-ui's thread, fed by `like`,
 * with what the agent is asking above its composer.
 */
function Thread({
	conversation,
	agent,
	onBack,
}: {
	conversation: ConversationState;
	/** The agent's name. */
	agent: string;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	const { id, status, model, archived } = conversation;
	const running = status === "running";
	const messages = useMemo(
		() => conversation.messages.map((message, index) => like(message, index)),
		[conversation.messages],
	);
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		// A stopped conversation takes a prompt, which resumes it, and one
		// still starting holds it until the session opens.
		isDisabled: archived,
		convertMessage: (message: ThreadMessageLike) => message,
		onNew: async (message) => {
			const text = message.content
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("")
				.trim();
			await promptConversation(id, text).catch((error: unknown) => {
				refused("Not sent", error);
				throw error;
			});
		},
		onCancel: async () => {
			await cancelConversation(id).catch((error: unknown) =>
				refused("Not cancelled", error),
			);
		},
	});
	const mentions = useFileMentions(conversation.task);
	const [renaming, setRenaming] = useState(false);

	return (
		<section
			aria-label={nameOf(conversation)}
			className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col gap-3"
		>
			<header className="flex items-center gap-2">
				{onBack !== null && <Back onBack={onBack} />}
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
						className="min-w-0 flex-1 truncate font-medium text-sm"
					>
						{nameOf(conversation)}
					</h2>
				)}
				{archived ? (
					<Badge variant="secondary">archived</Badge>
				) : (
					<StatusBadge status={status} />
				)}
				{model !== null && !archived && (
					<select
						aria-label="model"
						value={model.current}
						onChange={(event) =>
							chooseModel(id, event.target.value).catch((error: unknown) =>
								refused("Model not switched", error),
							)
						}
						className={SELECT}
					>
						{model.options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.name}
							</option>
						))}
					</select>
				)}
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						archiveConversation(id, !archived).catch((error: unknown) =>
							refused(archived ? "Not unarchived" : "Not archived", error),
						)
					}
				>
					<ArchiveIcon data-icon="inline-start" />
					{archived ? "Unarchive" : "Archive"}
				</Button>
			</header>
			{conversation.error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{conversation.error}
				</p>
			)}
			<div className="min-h-0 flex-1">
				<AssistantRuntimeProvider runtime={runtime}>
					<ThreadView
						mentions={mentions ?? undefined}
						above={
							conversation.ask !== null && (
								<AskPanel
									key={conversation.ask.id}
									conversation={conversation}
									agent={agent}
									ask={conversation.ask}
								/>
							)
						}
					/>
				</AssistantRuntimeProvider>
			</div>
		</section>
	);
}

/**
 * A message as assistant-ui takes one, the one place ACP's shape meets
 * assistant-ui's: a tool call carries a result only once it has finished.
 */
function like(message: Message, index: number): ThreadMessageLike {
	return {
		id: String(index),
		role: message.role === "user" ? "user" : "assistant",
		content: message.parts.map((part) => {
			switch (part.type) {
				case "text":
					return { type: "text", text: part.text };
				case "thought":
					return { type: "reasoning", text: part.text };
				case "tool":
					return {
						type: "tool-call",
						toolCallId: part.id,
						toolName: part.title,
						args: {},
						...(part.status === "completed" || part.status === "failed"
							? { result: part.status, isError: part.status === "failed" }
							: {}),
					};
				default:
					return part satisfies never;
			}
		}),
	};
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
	conversation,
	agent,
	ask,
}: {
	conversation: ConversationState;
	agent: string;
	ask: Ask;
}): JSX.Element {
	const send = (answer: Answer) =>
		answerConversation(conversation.id, ask.id, answer).catch(
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
		<Question ask={ask} send={send} />
	);
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
}: {
	ask: Extract<Ask, { type: "question" }>;
	send: (answer: Answer) => Promise<unknown>;
}): JSX.Element {
	const [typed, setTyped] = useState<Record<string, string>>({});
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
					onChange={(event) =>
						setTyped({ ...typed, [field.key]: event.target.value })
					}
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

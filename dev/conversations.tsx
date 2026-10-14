// scry-ignore-file compact-files: split by a todo in arbor lanes 11 to 19, which removes this line
import {
	type AppendMessage,
	type AssistantRuntime,
	AssistantRuntimeProvider,
	type AttachmentAdapter,
	type ThreadMessageLike,
	type TriggerAdapter,
	useAuiState,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	ChevronDownIcon,
	FileDiffIcon,
	GitBranchIcon,
	ListTodoIcon,
	PencilIcon,
	SendHorizontalIcon,
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
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration, SystemTimer } from "webappwiz/time";
import { Annotation } from "#dev/annotation.ts";
import { PermissionGrant } from "#dev/components/assistant-ui/elements/permission-grant.tsx";
import { QuestionFlow } from "#dev/components/assistant-ui/elements/question-flow.tsx";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
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
import { type Report, stretches } from "../asked";
import type {
	Answer,
	Ask,
	Command,
	ConversationState,
	Message,
	Part,
	Setting,
} from "../conversations";
import { type LaneRecord, named } from "../lanes";
import { modelOption } from "../models";
import { need } from "../needs";
import { leadingDirectives, taskReference, todoReference } from "../prompts";
import type { Details } from "../show";
import type { NamedSystem } from "../systems";
import type { TodoState } from "../todo";
import {
	type Action,
	useWidgets,
	WIDGETS_ROOM,
	Widgets,
	WidgetsButton,
} from "./actions";
import { AgentBrand, AgentIcon } from "./agent-icons";
import {
	answerConversation,
	cancelConversation,
	chooseSetting,
	conversationAttachment,
	systems as fetchSystems,
	markUnread,
	paths,
	promptConversation,
	sendQueuedNow,
	startConversation,
	unqueueConversation,
} from "./api";
import { Back } from "./back";
import { BackgroundRow } from "./background";
import { Board } from "./board";
import { ENDINGS, TONES } from "./card-shell";
import { ReviewChanges } from "./changes";
import { focusComposer } from "./composer-editor";
import {
	ARCHIVED,
	agentFor,
	modelFor,
	NEW,
	startsOne,
	taskFor,
} from "./conversation-address";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
	SEEN,
} from "./conversation-feed";
import { Item, Rename, useArchive, whereOf } from "./conversation-item";
import { ConversationList } from "./conversation-list";
import { lastReport, nameOf, reportedAs, unnamed } from "./conversation-names";
import { goOn, needOf, rowsOf } from "./conversation-rows";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import { Directed, DirectiveChip } from "./directives";
import { Trunk } from "./dispatching";
import { type Drafts, newDraft } from "./drafts";
import { useShortcut, useShortcutLabel } from "./hooks/use-shortcut";
import { Mark } from "./mark";
import { type Named, NamedContext } from "./mentioned";
import { rank } from "./mentions";
import { limitsOf, PlanLimits } from "./plan-limits";
import {
	QuestionsUI,
	type Reply,
	ReplyContext,
	ReviewUI,
} from "./question-cards";
import { useReferences } from "./references";
import { Refusal, useRefusal, useRefusals } from "./refusal";
import {
	ReportUI,
	StartNewContext,
	StartUI,
	TodoUI,
	type Turn,
} from "./report-cards";
import { SystemsCard } from "./systems";
import { TASK, TaskLine, TaskView, toWaiting, useArrived } from "./task-view";
import { Task } from "./tasks";
import { MainTerminal, ToggleTerminal } from "./terminal";
import { isMain, type Terminals } from "./terminals";
import { TodoDialog } from "./todos";
import { ContextMeter } from "./usage";
import { replyDue, stretchesOf } from "./work";
import { StoppedUI, TreesContext, WorkUI } from "./work-row";

/**
 * A bar above the composer while the conversation's last word is the report
 * of a task that is over, offering to put the conversation away: what to do
 * once nothing is left to say. It goes as the conversation carries on.
 */
function ArchiveBar({
	report,
	onArchive,
}: {
	report: Report;
	onArchive: () => void;
}): JSX.Element {
	const { title, Icon, tone } = ENDINGS[report.ending];
	const shortcut = useShortcutLabel("shortcuts.archive");
	return (
		<section
			aria-label="archive"
			className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm shadow-xs"
		>
			<Icon className={cn("size-4 shrink-0", TONES[tone].icon)} />
			<span className="min-w-0 truncate">
				{title} <span className="font-mono text-xs">{report.task}</span>
			</span>
			{shortcut !== null && <Kbd className="ml-auto">{shortcut}</Kbd>}
			<Button
				size="sm"
				variant="outline"
				onClick={onArchive}
				className={cn(
					"h-7 gap-1.5 bg-background",
					shortcut === null && "ml-auto",
				)}
			>
				<ArchiveIcon data-icon="inline-start" />
				Archive
			</Button>
		</section>
	);
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
	// one over that, so the conversation keeps its place. Both go once
	// another conversation opens, as one started from them does.
	const [openedTodo, setOpenedTodo] = useState<number | null>(null);
	const [openedTask, setOpenedTask] = useState<string | null>(null);
	const [openedOver, setOpenedOver] = useState(open);
	if (openedOver !== open) {
		setOpenedOver(open);
		setOpenedTodo(null);
		setOpenedTask(null);
	}
	const board = useMemo(
		() => ({
			linked: true,
			todos,
			lanes: named(todos, lanes),
			open: setOpenedTodo,
			openTask: setOpenedTask,
			tasks: tasks.map((each) => each.task),
			moveLane: () => {},
			refusedTodos: new Map(),
			refusedLanes: new Map(),
			refuseLane: () => {},
			drafts,
		}),
		[todos, lanes, drafts, tasks],
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
						onLeft={() =>
							goOn(rowsOf(tasks, conversations), drafts, open, onOpen)
						}
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
	const restore = useRef<(text: string, files: File[]) => void>(() => {});
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
		adapters: { attachments: FILES },
		onNew: async (message) => {
			const text = said(message);
			const files = filesOf(message);
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
				restore.current(text, files);
				refuse("Not started", error);
				throw error;
			});
			feed.put(state);
			// Shown at once in its thread, so the person watches the agent come
			// up; the message waits on the server for the session to open.
			const sending =
				text !== "" || files.length > 0
					? feed.send(state.id, noted(text, files), files)
					: null;
			onOpen(state.id);
			await promptConversation(state.id, noted(text, files), files).catch(
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
	const { adapter: mentions, paths } = useFileMentions(task);
	const systems = useSystems(task, tasks);
	const references = useReferences(tasks, [], systems ?? undefined);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		task === null
			? root
			: (tasks.find((each) => each.task === task)?.worktree ?? null),
	);

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
					<NamedContext value={named}>
						<ThreadView
							mentions={mentions ?? undefined}
							references={references}
							above={<Refusal refusal={refusal} className="px-2" />}
							welcome={
								<div className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 font-medium text-2xl tracking-tight duration-200">
									<span>Start a conversation with</span>
									<AgentBrand agent={agent} name={agentName(agents, agent)} />
									{task !== null && (
										<span>
											in <span className="font-mono text-xl">{task}</span>
										</span>
									)}
								</div>
							}
							below={
								<>
									<PlanLimits limits={limitsOf(agents, conversations, agent)} />
									{recent.length > 0 && (
										<section
											aria-label="recent conversations"
											className="mt-4 flex flex-col gap-1 px-2"
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
								</>
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
					</NamedContext>
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
					const files = message.parts.flatMap((part) =>
						part.type === "file" ? [part] : [],
					);
					const { directives, rest } = leadingDirectives(text);
					const sent = images.length + files.length;
					const label =
						text ||
						(files.length === 0
							? images.length === 1
								? "an image"
								: `${images.length} images`
							: sent === 1
								? (files[0]?.title ?? "a file")
								: `${sent} files`);
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
									src={conversationAttachment(conversation, image)}
									alt=""
									className="size-6 shrink-0 rounded object-cover ring-1 ring-foreground/10"
								/>
							))}
							{directives.map((directive) => (
								<DirectiveChip key={directive} directive={directive} />
							))}
							<span className="min-w-0 flex-1 truncate text-sm">
								<Directed text={rest} />
							</span>
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
 * Atop an archived conversation, across the pane's padding to its edges,
 * saying so and how it comes back.
 */
function ArchivedBanner(): JSX.Element {
	return (
		<p
			role="status"
			className="-mx-4 -mt-4 flex shrink-0 items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-muted-foreground text-sm"
		>
			<ArchiveIcon className="size-4 shrink-0" />
			<span>
				<span className="font-medium text-foreground">
					This conversation is archived.
				</span>{" "}
				Sending a message unarchives it.
			</span>
		</p>
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
): (text: string, files: File[]) => void {
	useEffect(() => {
		const composer = runtime.thread.composer;
		// Into an empty composer only: what is typed there is the newer draft.
		const fill = () => {
			const kept = drafts.read(key);
			if (kept !== "" && composer.getState().isEmpty) {
				composer.setText(kept);
			}
		};
		const unsubscribe = composer.subscribe(() =>
			drafts.write(key, composer.getState().text),
		);
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
	return (text, files) => {
		const composer = runtime.thread.composer;
		// Typed again since it was sent: that is the newer draft.
		if (!composer.getState().isEmpty) {
			return;
		}
		composer.setText(text);
		for (const file of files) {
			void composer.addAttachment(file);
		}
	};
}

/** What `message` says, its directives among its words; its files go apart. */
function said(message: AppendMessage): string {
	return message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("")
		.trim();
}

/**
 * `text` as the agent is sent it: then the notes on the marks drawn on the
 * images among `files`, which it reads beside the numbers drawn in. A message that comes
 * back to the composer unsent comes back as `text`, its images still marked
 * up, so the notes are not said twice.
 */
function noted(text: string, files: readonly File[]): string {
	// Counted among the images, as their chips are.
	const images = files.filter((file) => SEEN.includes(file.type));
	return [text, Annotation.notesFor(images)]
		.filter((each) => each !== "")
		.join("\n\n");
}

/**
 * Any file, held as it is until the message goes: an image the agent can be
 * sent as one is an image, to mark up, and the server sends the agent a link
 * to anything else.
 */
const FILES: AttachmentAdapter = {
	accept: "*",
	add: async ({ file }) => ({
		id: crypto.randomUUID(),
		type: SEEN.includes(file.type) ? "image" : "file",
		name: file.name,
		contentType: file.type,
		file,
		status: { type: "requires-action", reason: "composer-send" },
	}),
	// Read from the file itself as the message goes, so never into memory here.
	send: async (attachment) => ({
		...attachment,
		status: { type: "complete" },
		content: [],
	}),
	remove: async () => {},
};

/** The files attached to `message`. */
function filesOf(message: AppendMessage): File[] {
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
	/**
	 * Once it is archived, to go on to the next agent waiting on you, or a new
	 * conversation with none.
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
	// The latest words wait a moment to show as the reply: shown again once due.
	const latest = conversation.messages.findLast((each) => !each.queued);
	const due = writing && latest?.role === "agent" ? replyDue(latest) : null;
	const [shown, show] = useState(0);
	useEffect(() => {
		const wait = due === null ? 0 : due - Date.now();
		if (wait <= 0) {
			return;
		}
		const timer = new SystemTimer().setTimeout(
			() => show((times) => times + 1),
			Duration.ms(wait),
		);
		return () => timer.dispose();
	}, [due]);
	const messages = useMemo(() => {
		void shown;
		const now = Date.now();
		const said = conversation.messages.filter((each) => !each.queued);
		const liked = said.map((message, index) =>
			like(
				message,
				index,
				conversation.id,
				!writing || index < said.length - 1,
				said[index - 1]?.at ?? message.at,
				now,
				conversation.lastTask,
			),
		);
		// The reply's place while the agent has yet to say anything, under the
		// id the reply will take: assistant-ui's own placeholder has an id of its
		// own, so the reply would mount afresh in its place and fade in again.
		// It holds the work row already, so the
		// agent's first move fills that row rather than putting one in its place.
		const prompt = said.at(-1);
		return running && prompt?.role === "user"
			? [
					...liked,
					like(
						{ role: "agent", parts: [], plan: null, at: null, until: null },
						said.length,
						conversation.id,
						false,
						prompt.at,
						now,
					),
				]
			: liked;
	}, [
		conversation.messages,
		conversation.id,
		conversation.lastTask,
		writing,
		running,
		shown,
	]);
	// Where the person left off, as it opens: the first message they have yet
	// to see, read on from there, else the bottom. Opening marks it read, so
	// this holds what it was before.
	const [openAt] = useState(() =>
		conversation.unread ? String(conversation.seen) : undefined,
	);
	// Its last word asks questions, escalates, or asks for a review, or it
	// asks as it works: the card takes the focus, not the composer, unless it
	// holds a draft.
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
	const restore = useRef<(text: string, files: File[]) => void>(() => {});
	const send = useCallback(
		async (text: string, files: File[]) => {
			// The server says nothing of it until the agent is back up.
			const sending =
				status !== "idle" &&
				status !== "running" &&
				(text !== "" || files.length > 0)
					? feed.send(id, noted(text, files), files)
					: null;
			await promptConversation(id, noted(text, files), files).catch(
				(error: unknown) => {
					if (sending !== null) {
						feed.sent(id, sending);
					}
					restore.current(text, files);
					refused("Not sent", error);
					throw error;
				},
			);
		},
		[id, status, feed, refused],
	);
	const say = useCallback(
		(message: AppendMessage) => send(said(message), filesOf(message)),
		[send],
	);
	const runtime = useExternalStoreRuntime({
		messages,
		isRunning: running,
		// A stopped conversation takes a prompt, which resumes it, unarchiving
		// an archived one, and one still starting holds it until the session
		// opens.
		convertMessage: (message: ThreadMessageLike) => message,
		adapters: { attachments: FILES },
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
	const { adapter: mentions, paths } = useFileMentions(conversation.task);
	const commands = useCommands(conversation.commands);
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
		const { text, files } = taken;
		const composer = runtime.thread.composer;
		const typed = composer.getState().text;
		composer.setText(
			typed === "" || text === "" ? `${text}${typed}` : `${text}\n\n${typed}`,
		);
		for (const file of files) {
			void composer.addAttachment(file);
		}
		focusComposer(section.current);
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
	const archiveKey = useShortcutLabel("shortcuts.archive");
	const terminalKey = useShortcutLabel("shortcuts.terminal");
	// The newest card it waits on you through.
	useArrived(id, () => toWaiting(section.current));
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
						detail: terminalKey !== null && <Kbd>{terminalKey}</Kbd>,
						run: () => terminal(id),
					},
				]
			: []),
		{
			label: archived ? "Unarchive" : "Archive",
			icon: archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />,
			detail:
				archived || archiveKey === null ? undefined : <Kbd>{archiveKey}</Kbd>,
			run: () => archive.file(archived ? undefined : onLeft),
		},
	];
	const systems = useSystems(conversation.task, tasks);
	const references = useReferences(tasks, actions, systems ?? undefined);
	const root = useContext(TreesContext)?.root ?? null;
	const named = useNamed(
		paths,
		systems,
		task?.worktree ?? (conversation.task === null ? root : null),
	);
	// Already archived, the key does nothing.
	const fileByKey = () => {
		if (!archived) {
			archive.file(onLeft);
		}
	};
	useShortcut("shortcuts.archive", fileByKey);
	// What the conversation's last word reports, to offer archiving it when
	// the task is over.
	const report = lastReport(conversation);
	const ended =
		report !== null && report.ending !== "escalated" && !archived
			? report
			: null;
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
	const widgets = useWidgets(section);
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
			{archived && <ArchivedBanner />}
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
				<WidgetsButton
					open={widgets.open}
					onToggle={widgets.toggle}
					busy={conversation.background.some(
						(each) => each.state === "running",
					)}
				/>
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
			<TaskRegistry>
				{(version) => (
					<div
						className="relative min-h-0 flex-1"
						style={{
							["--thread-inset-end" as string]:
								widgets.roomy && widgets.open ? WIDGETS_ROOM : "0px",
						}}
					>
						<AssistantRuntimeProvider runtime={runtime}>
							<Composing.Provider value={runtime.thread.composer}>
								<QuestionsUI />
								<ReviewUI />
								<ReportUI />
								<StartUI />
								<TodoUI />
								<DemoUI />
								<WorkUI />
								<StoppedUI />
								<StartNewContext value={startNew}>
									<ReplyContext value={reply}>
										<NamedContext value={named}>
											<ThreadView
												openAt={openAt}
												autoFocus={!asking || typed}
												mentions={mentions ?? undefined}
												references={references}
												commands={commands ?? undefined}
												placeholder={
													archived
														? "Send a message to unarchive and continue"
														: undefined
												}
												controls={
													!archived && (
														<>
															<ContextMeter usage={conversation.usage} />
															{settings.map((setting) => (
																<SettingControl
																	key={setting.id}
																	setting={setting}
																	value={setting.current}
																	onChange={(value) =>
																		chooseSetting(id, setting.id, value).catch(
																			(error: unknown) =>
																				refused(
																					`${setting.name} not switched`,
																					error,
																				),
																		)
																	}
																/>
															))}
														</>
													)
												}
												above={
													<>
														<Refusal refusal={refusal} className="px-2" />
														{ended !== null && (
															<ArchiveBar
																report={ended}
																onArchive={() => archive.file(onLeft)}
															/>
														)}
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
										</NamedContext>
									</ReplyContext>
								</StartNewContext>
							</Composing.Provider>
						</AssistantRuntimeProvider>
						<Widgets
							roomy={widgets.roomy}
							open={widgets.open}
							onClose={widgets.close}
							actions={actions}
							background={
								<BackgroundRow
									conversation={id}
									background={conversation.background}
								/>
							}
						>
							<SystemsCard systems={task?.systems ?? []} />
							<CurrentTask version={version} />
						</Widgets>
					</div>
				)}
			</TaskRegistry>
		</section>
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
 * assistant-ui's. An agent's turn is what it said, a `data-work` part for
 * each run of work between, its reply the last thing it said, and a
 * `data-stopped` part when the person stopped it.
 */
function like(
	message: Message,
	index: number,
	/** The conversation it is in, to read its images from. */
	conversation: string,
	settled = true,
	/** When the turn began: the person's prompt it answers. */
	began: string | null = message.at,
	/** The clock, as epoch ms, the latest words of a turn still going wait on. */
	now = Number.POSITIVE_INFINITY,
	/** The task it runs in, or last ran in, whose todos it can have added. */
	task: string | null = null,
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
				part.type === "image" || part.type === "file"
					? [attached(conversation, part)]
					: [],
			),
			// Marked as taken into the turn the agent was running.
			metadata: { custom: { steered: message.steered ?? false } },
		};
	}
	// Its work and the words it said along the way as one row, but for its
	// word that it added a task, then the last thing it said. Once the turn is
	// over, that is its reply, read for cards, even with tool calls after it.
	const all = stretchesOf(message, began, !settled, now);
	const reply = all.findLastIndex((stretch) => stretch.type === "said");
	return {
		id,
		role: "assistant",
		content: [
			...all.flatMap((stretch, at): LikePart[] =>
				stretch.type === "work"
					? [{ type: "data-work", data: { work: stretch.work } }]
					: stretch.type === "added"
						? stretches(stretch.text).flatMap((each): LikePart[] =>
								each.type === "start"
									? [{ type: "data-start", data: { start: each.start } }]
									: each.type === "text"
										? [{ type: "text", text: each.text }]
										: [],
							)
						: at === reply
							? replied(stretch.text, settled, {
									task,
									began,
									until: message.until,
								})
							: [{ type: "text", text: stretch.text }],
			),
			...(message.stopped === undefined
				? []
				: [{ type: "data-stopped" as const, data: { at: message.stopped } }]),
		],
	};
}

/** A file the person sent, as assistant-ui shows an attachment. */
function attached(
	conversation: string,
	part: Extract<Part, { type: "image" | "file" }>,
): NonNullable<ThreadMessageLike["attachments"]>[number] {
	const url = conversationAttachment(conversation, part);
	return {
		id: part.name,
		type: part.type,
		name: part.type === "file" ? part.title : part.name,
		contentType: part.mimeType,
		status: { type: "complete" },
		content:
			part.type === "image"
				? [{ type: "image", image: url }]
				: [
						{
							type: "file",
							data: url,
							mimeType: part.mimeType,
							filename: part.title,
							sourceType: "url",
						},
					],
	};
}

/**
 * The agent's reply, its questions and review as cards once it has stopped
 * writing them: a list mid-stream may yet turn out not to ask any. An
 * escalation's questions come right after it, or after the demo they ask
 * about, so they are one card: the questions, headed as the escalation, the
 * demo above them. A run of todos is one part, with `turn` to say which
 * of them it added, and `next` whether it follows a merge or remove report.
 */
function replied(text: string, settled: boolean, turn: Turn): LikePart[] {
	if (!settled) {
		return [{ type: "text", text }];
	}
	const all = stretches(text);
	return all.flatMap((stretch, at): LikePart[] => {
		const before = all[at - 1];
		const after = all[at + 1];
		// The questions an escalation ends, past the demo between them.
		const asking = after?.type === "demo" ? all[at + 2] : after;
		switch (stretch.type) {
			case "text":
				return [{ type: "text", text: stretch.text }];
			case "questions": {
				const demo = before?.type === "demo" ? before.demo : null;
				const heading = demo === null ? before : all[at - 2];
				return [
					{
						type: "data-questions",
						data: {
							questions: stretch.questions,
							escalation:
								heading?.type === "report" &&
								heading.report.ending === "escalated"
									? heading.report
									: null,
							demo,
						},
					},
				];
			}
			case "demo":
				return after?.type === "questions"
					? []
					: [{ type: "data-demo", data: { demo: stretch.demo } }];
			case "review":
				return [{ type: "data-review", data: { review: stretch.review } }];
			case "start":
				return [{ type: "data-start", data: { start: stretch.start } }];
			case "report":
				return stretch.report.ending === "escalated" &&
					asking?.type === "questions"
					? []
					: [{ type: "data-report", data: { report: stretch.report } }];
			case "todo": {
				// A run of todos is one part, to gather those added to a lane.
				if (before?.type === "todo") {
					return [];
				}
				const run = all.slice(at);
				const end = run.findIndex((each) => each.type !== "todo");
				const todos = (end === -1 ? run : run.slice(0, end)).flatMap((each) =>
					each.type === "todo" ? [each.todo] : [],
				);
				// Those right after a task ended are what to take up next.
				const next =
					before?.type === "report" && before.report.ending !== "escalated";
				return [{ type: "data-todo", data: { todos, turn, next } }];
			}
			default:
				return stretch satisfies never;
		}
	});
}

/**
 * The tree's paths for the composer's `@`, once they have loaded, and as the
 * set a sent message's `@` mentions are found in; null while they load.
 */
function useFileMentions(task: string | null): {
	adapter: TriggerAdapter | null;
	paths: ReadonlySet<string> | null;
} {
	const [all, setAll] = useState<string[] | null>(null);
	useEffect(() => {
		let current = true;
		paths(task ?? "").then(
			(found) => current && setAll(found),
			// Without the list, `@` is only a character: nothing else breaks.
			() => current && setAll([]),
		);
		return () => {
			current = false;
		};
	}, [task]);
	return useMemo(
		() => ({
			adapter:
				all === null || all.length === 0
					? null
					: {
							categories: () => [],
							categoryItems: () => [],
							search: (query: string) =>
								(query === "" ? all : rank(all, query))
									.slice(0, MENTIONS_SHOWN)
									.map((path) => ({ id: path, type: "file", label: path })),
						},
			paths: all === null ? null : new Set(all),
		}),
		[all],
	);
}

const MENTIONS_SHOWN = 8;

/**
 * What a tree names, for `NamedContext`, from its `paths` and `systems`, each
 * null while it loads, and where it sits.
 */
function useNamed(
	paths: ReadonlySet<string> | null,
	systems: NamedSystem[] | null,
	tree: string | null,
): Named {
	return useMemo(
		() => ({
			systems: systems ?? [],
			paths: paths ?? new Set(),
			tree,
			resolving: { paths: paths === null, systems: systems === null },
		}),
		[paths, systems, tree],
	);
}

/**
 * The systems the tree `task` runs in names, for `#`; null until they come,
 * and none when they cannot. Asked again whenever the tasks move, which an
 * edit to a worktree's config does.
 */
function useSystems(
	task: string | null,
	tasks: readonly Details[],
): NamedSystem[] | null {
	const [named, setNamed] = useState<NamedSystem[] | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `tasks` only says when to ask again.
	useEffect(() => {
		let current = true;
		fetchSystems(task ?? "").then(
			(found) => current && setNamed(found),
			() => current && setNamed((named) => named ?? []),
		);
		return () => {
			current = false;
		};
	}, [task, tasks]);
	return named;
}

/**
 * The agent's skills and commands for the composer's `/`, those whose name
 * starts with what was typed first, then those that hold it; none until the
 * agent says what it has.
 */
function useCommands(commands: Command[]): TriggerAdapter | null {
	return useMemo(
		() =>
			commands.length === 0
				? null
				: {
						categories: () => [],
						categoryItems: () => [],
						search: (query: string) => {
							const typed = query.toLowerCase();
							const named = (command: Command) => command.name.toLowerCase();
							return [
								...commands.filter((each) => named(each).startsWith(typed)),
								...commands.filter(
									(each) =>
										!named(each).startsWith(typed) &&
										named(each).includes(typed),
								),
							].map((command) => ({
								id: command.name,
								type: "command",
								label: command.name,
								description: command.description,
							}));
						},
					},
		[commands],
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
				event.target.closest("input, textarea, select, [contenteditable]") !==
					null;
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

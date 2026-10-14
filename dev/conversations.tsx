// scry-ignore-file compact-files: split by a todo in arbor lanes 11 to 19, which removes this line
import {
	type AppendMessage,
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import {
	ArchiveIcon,
	ArchiveRestoreIcon,
	FileDiffIcon,
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
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration, SystemTimer } from "webappwiz/time";
import { Thread as ThreadView } from "#dev/components/assistant-ui/elements/thread.aui.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { Composing } from "#dev/composing.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Report } from "../asked";
import type { ConversationState } from "../conversations";
import { type LaneRecord, named } from "../lanes";
import { need } from "../needs";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import {
	type Action,
	useWidgets,
	WIDGETS_ROOM,
	Widgets,
	WidgetsButton,
} from "./actions";
import {
	cancelConversation,
	chooseSetting,
	markUnread,
	promptConversation,
	sendQueuedNow,
	unqueueConversation,
} from "./api";
import { AskPanel } from "./ask-panel";
import { Back } from "./back";
import { BackgroundRow } from "./background";
import { Board } from "./board";
import { ENDINGS, TONES } from "./card-shell";
import { ReviewChanges } from "./changes";
import {
	FILES,
	filesOf,
	noted,
	said,
	useDraft,
	useReply,
	useTyped,
} from "./composer-drafts";
import { focusComposer } from "./composer-editor";
import {
	useCommands,
	useFileMentions,
	useNamed,
	useSystems,
} from "./composer-triggers";
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
} from "./conversation-feed";
import { Home } from "./conversation-home";
import { Item, Rename, useArchive } from "./conversation-item";
import { ConversationList } from "./conversation-list";
import { lastReport, nameOf, unnamed } from "./conversation-names";
import { goOn, needOf, rowsOf } from "./conversation-rows";
import { CurrentTask, TaskRegistry } from "./current-task";
import { DemoUI } from "./demo-cards";
import { type Drafts, newDraft } from "./drafts";
import { useShortcut, useShortcutLabel } from "./hooks/use-shortcut";
import { NamedContext } from "./mentioned";
import { QuestionsUI, ReplyContext, ReviewUI } from "./question-cards";
import { Queued } from "./queued";
import { useReferences } from "./references";
import { Refusal, useRefusals } from "./refusal";
import { ReportUI, StartNewContext, StartUI, TodoUI } from "./report-cards";
import { SettingControl } from "./setting-controls";
import { SystemsCard } from "./systems";
import { TakeUp } from "./take-up";
import { TASK, TaskLine, TaskView, toWaiting, useArrived } from "./task-view";
import { Task } from "./tasks";
import { MainTerminal, ToggleTerminal } from "./terminal";
import { isMain, type Terminals } from "./terminals";
import { like } from "./thread-messages";
import { TodoDialog } from "./todos";
import { ContextMeter } from "./usage";
import { replyDue } from "./work";
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

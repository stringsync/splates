import type { TaskRecord } from "@stringsync/splates-server/board";
import {
	type LaneRecord,
	lanesTaken,
	named,
} from "@stringsync/splates-server/board/browser";
import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { Details } from "@stringsync/splates-server/tasks";
import { useReactive } from "@webappwiz/react";
import { ChevronLeftIcon } from "lucide-react";
import {
	type JSX,
	memo,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration } from "webappwiz/time";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { Board, takenTask } from "./board";
import {
	ARCHIVED,
	agentFor,
	draftFor,
	modelFor,
	NEW,
	startsAuto,
	startsOne,
	taskFor,
	terminalOf,
	withDraft,
} from "./conversation-address";
import { markUnread } from "./conversation-api";
import {
	type AgentChoice,
	agentName,
	type ConversationFeed,
} from "./conversation-feed";
import { Home } from "./conversation-home";
import { useConversation, useConversationIndex } from "./conversation-index";
import { Item } from "./conversation-item";
import { goOn, needOf, rowsOf } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useExpect } from "./expecting";
import { FinishedByName } from "./finished-tasks";
import { Locked } from "./freshness";
import { useNow } from "./hooks/use-now";
import type { Move } from "./page-address";
import { PhoneHome } from "./phone-home";
import { ago } from "./plan-limits";
import { useRefusals } from "./refusal";
import { Task } from "./task-dialog";
import {
	ConversationTerminal,
	MainTerminal,
	RunInTerminal,
	ShowTerminal,
} from "./terminal";
import { isMain, type Terminals } from "./terminals";
import { Thread } from "./thread";
import { TodoDialog } from "./todo-dialog";
import { BarButton, TopBar } from "./top-bar";

/**
 * The open conversation, or the archived ones when `open` is `ARCHIVED`. On a
 * phone, where the inbox lists them in place of a sidebar, each has a way back
 * to it.
 */
export const Conversations = memo(function Conversations({
	feed,
	terminals,
	drafts,
	tasks,
	todos,
	lanes,
	trunk,
	open,
	onOpen,
	onTodos,
	onLane,
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
	todos: TaskRecord[];
	lanes: LaneRecord[];
	/** The main tree's branch. */
	trunk: string;
	open: string | null;
	/** Opens `id`, or the list for null, in place of what is open for `replace`. */
	onOpen: (id: string | null, how?: Move) => void;
	/** Opens the todo board showing only the todos in `ids`. */
	onTodos: (ids: readonly number[]) => void;
	onLane: (id: number) => void;
	/** Whether there is no sidebar to hold the list. */
	phone: boolean;
}): JSX.Element {
	const conversations = useConversationIndex(feed);
	const { agents } = useReactive(feed, (feed) => ({ agents: feed.agents }), [
		"changed",
	]);
	const shown = useConversation(feed, open);
	const shownTask =
		shown === null
			? null
			: (tasks.find((each) => each.task === shown.task) ?? null);
	// A conversation whose terminal has a page of its own, at `<id>/terminal`.
	const shelled = terminalOf(open);
	const shelledIn =
		conversations.find((each) => each.id === shelled && !each.archived) ?? null;
	const showTerminal = useContext(ShowTerminal);
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
	// Said on the card, as the dialog that refused it closed at the click.
	const { refusals: refusedTodos, refuse: refuseTodo } = useRefusals<number>();
	const board = useMemo(
		() => ({
			linked: true,
			todos,
			lanes: named(todos, lanes),
			open: (id: number) => {
				const task = takenTask(todos, tasks, id);
				if (task === null) {
					setOpenedTodo(id);
				} else {
					setOpenedTask(task);
				}
			},
			openTask: setOpenedTask,
			openTodos: onTodos,
			openLane: onLane,
			tasks: tasks.map((each) => each.task),
			moveLane: () => {},
			refusedTodos,
			refuseTodo,
			refusedLanes: new Map(),
			refuseLane: () => {},
			drafts,
		}),
		[todos, lanes, drafts, tasks, onTodos, onLane, refusedTodos, refuseTodo],
	);
	const todo = todos.find((each) => each.id === openedTodo);
	const task = tasks.find((each) => each.task === openedTask);
	// What a main-tree conversation can take up: a live task no listed
	// conversation runs in, nor one about to. `splates claim` refuses one an
	// external agent still holds, so its agent says so.
	const free = tasks.filter(
		(each) =>
			each.status === "working" &&
			!each.dispatched &&
			!conversations.some(
				(conversation) =>
					!conversation.archived && conversation.task === each.task,
			),
	);
	// By conversation, so a message Home sends to one it just started can be
	// refused in that one's thread.
	const { refusals, refuse } = useRefusals<string>();
	// What is open now, for a start refused after its thread opened.
	const opened = useRef(open);
	opened.current = open;
	useRead(shown);
	// What a new conversation starts with. Its picks are for one agent's
	// settings, and its draft for one tree, so it starts over for another.
	const starting = {
		drafts,
		tasks,
		feed,
		agents,
		agent: agentFor(open, agents, conversations),
		auto: startsAuto(open),
		task: taskFor(open),
		model: modelFor(open),
		identity: draftFor(open),
		conversations,
		refuseIn: refuse,
		onOpen: (id: string, how?: Move) =>
			onOpen(startsOne(id) ? withDraft(id, draftFor(open)) : id, how),
		refusals,
		onRefused: (id: string, address: string) => {
			if (opened.current === id) {
				onOpen(address, "replace");
			}
		},
	};
	const startKey = `${starting.auto}/${starting.agent}/${starting.task}/${starting.model}/${starting.identity}/${startsOne(open)}`;

	return (
		<Board value={board}>
			{/* What a view transition fades, as `slide` starts a conversation. */}
			<div className="flex h-full flex-col gap-4 [view-transition-name:conversation]">
				{startsOne(open) || open === null ? (
					phone ? (
						<PhoneHome
							key={startKey}
							{...starting}
							terminals={terminals}
							onBack={() => onOpen(null)}
						/>
					) : (
						<Home key={startKey} {...starting} terminals={terminals} />
					)
				) : open !== null && isMain(open) ? (
					<MainTerminal
						key={open}
						terminals={terminals}
						terminal={open}
						trunk={trunk}
						onBack={phone ? () => onOpen(null) : null}
						onExit={() => onOpen(NEW, "replace")}
						onClose={() => {
							onOpen(NEW);
							terminals.close(open);
						}}
					/>
				) : shelled !== null ? (
					shelledIn === null ? (
						<Missing
							what="conversation"
							onBack={phone ? () => onOpen(null) : null}
						/>
					) : (
						<ConversationTerminal
							key={shelledIn.id}
							terminals={terminals}
							conversation={shelledIn}
							trunk={trunk}
							onBack={phone ? () => onOpen(null) : null}
							onConversation={() =>
								showTerminal === null
									? onOpen(shelledIn.id)
									: showTerminal(shelledIn.id)
							}
							// Hidden first, so the conversation's pane starts no other.
							onExit={() => {
								terminals.hide();
								onOpen(shelledIn.id, "replace");
							}}
							onClose={() => {
								terminals.hide();
								terminals.close(shelledIn.id);
								onOpen(shelledIn.id);
							}}
						/>
					)
				) : open === ARCHIVED ? (
					<Archived
						tasks={tasks}
						conversations={conversations.filter((each) => each.archived)}
						agents={agents}
						onOpen={onOpen}
						onBack={phone ? () => onOpen(null) : null}
					/>
				) : shown === null ? (
					<Missing
						what="conversation"
						onBack={phone ? () => onOpen(null) : null}
					/>
				) : (
					<Locked>
						<RunInTerminal
							value={
								shown.archived || showTerminal === null
									? null
									: (code) => {
											void terminals.run(shown.id, shown.task, code);
											showTerminal(shown.id);
										}
							}
						>
							<Thread
								key={shown.id}
								drafts={drafts}
								conversation={shown}
								feed={feed}
								agent={agentName(agents, shown.agent)}
								task={shownTask}
								tasks={tasks}
								free={free}
								trunk={trunk}
								refusal={refusals.get(shown.id) ?? null}
								refuseIn={refuse}
								// On a phone, back to the list, so it is plain what became of it:
								// opening the next one in its place reads as a jump.
								onLeft={() =>
									phone
										? onOpen(null, "replace")
										: goOn(
												rowsOf(tasks, conversations),
												open,
												lanesTaken(todos),
												(id) => onOpen(id, "replace"),
											)
								}
								onOpen={onOpen}
								onBack={phone ? () => onOpen(null) : null}
							/>
						</RunInTerminal>
					</Locked>
				)}
			</div>
			<TodoDialog todo={todo} onClose={() => setOpenedTodo(null)} />
			<Dialog
				open={openedTask !== null}
				onOpenChange={(open) => open || setOpenedTask(null)}
			>
				{task ? (
					<Task task={task} />
				) : (
					openedTask !== null && <FinishedByName name={openedTask} />
				)}
			</Dialog>
		</Board>
	);
});

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
	const expect = useExpect();
	// The one whose marking was refused, which shows it unread again: that is
	// no new turn to mark read, and marking it again would go round for good.
	const refused = useRef<string | null>(null);
	const id = conversation?.id ?? null;
	const unread = conversation?.unread ?? false;
	useEffect(() => {
		if (refused.current === id) {
			refused.current = null;
			return;
		}
		if (id !== null && unread && inFront) {
			// Nothing to tell anyone: the dot stays until the next try.
			expect(id, { unread: false }, markUnread(id, false)).catch(() => {
				refused.current = id;
			});
		}
	}, [id, unread, inFront, expect]);
}

/**
 * The archived conversations, newest first, each with how long ago it was
 * archived, to read or bring back: every one kept, since splates deletes the
 * older ones.
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
	const now = useNow(true, Duration.mins(1));
	const sorted = useMemo(
		() => conversations.toSorted(byArchivedAt),
		[conversations],
	);
	return (
		<section
			aria-label="archived conversations"
			className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-2"
		>
			<TopBar
				leading={
					onBack !== null && (
						<BarButton label="Back to conversations" onClick={onBack}>
							<ChevronLeftIcon />
						</BarButton>
					)
				}
				title="Archived"
			/>
			{conversations.length === 0 ? (
				<p className="text-muted-foreground text-sm">Nothing archived.</p>
			) : (
				<ul className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
					{sorted.map((each) => (
						<li key={each.id}>
							<Item
								conversation={each}
								agent={agentName(agents, each.agent)}
								need={needOf(tasks, each)}
								current={false}
								onOpen={() => onOpen(each.id)}
								where
								ago={
									each.archivedAt === null
										? null
										: ago(Date.parse(each.archivedAt), now)
								}
							/>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Archived last first, by when it started for a log too old to say. */
function byArchivedAt(
	one: ConversationState,
	other: ConversationState,
): number {
	return (other.archivedAt ?? other.createdAt).localeCompare(
		one.archivedAt ?? one.createdAt,
	);
}

/** In place of a conversation the address names and the page has none of. */
function Missing({
	what,
	onBack,
}: {
	what: string;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
}): JSX.Element {
	return (
		<>
			<TopBar
				leading={
					onBack !== null && (
						<BarButton label="Back to conversations" onClick={onBack}>
							<ChevronLeftIcon />
						</BarButton>
					)
				}
				title={`No such ${what}`}
			/>
			<p className="text-muted-foreground text-sm max-md:px-3">
				It may have ended, or the link may be wrong.
			</p>
		</>
	);
}

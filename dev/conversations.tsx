import { useReactive } from "@webappwiz/react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Dialog } from "#dev/components/ui/dialog.tsx";
import type { ConversationState } from "../conversations";
import { type LaneRecord, named } from "../lanes";
import { need } from "../needs";
import type { Details } from "../show";
import type { TodoState } from "../todo";
import { markUnread } from "./api";
import { Back } from "./back";
import { Board } from "./board";
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
import { Item } from "./conversation-item";
import { ConversationList } from "./conversation-list";
import { goOn, needOf, rowsOf } from "./conversation-rows";
import type { Drafts } from "./drafts";
import { useRefusals } from "./refusal";
import { TASK, TaskView } from "./task-view";
import { Task } from "./tasks";
import { MainTerminal } from "./terminal";
import { isMain, type Terminals } from "./terminals";
import { Thread } from "./thread";
import { TodoDialog } from "./todos";

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

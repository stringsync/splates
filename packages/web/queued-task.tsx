import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { ClosesOn, TaskRecord } from "@splates/server/board";
import type { ConversationState } from "@splates/server/conversations";
import type { SignalWait } from "@splates/server/signals";
import { ChevronLeftIcon, ListXIcon } from "lucide-react";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#web/composing.tsx";
import { cn } from "#web/lib/utils.ts";
import { useAdapters } from "./adapters";
import { AgentQueuedBanner } from "./agent-queued-banner";
import { assignTodo, queueTodo } from "./api";
import { BlockersCard } from "./blockers-card";
import { Board } from "./board";
import { assigned, queued } from "./board-expectations";
import { filesOf, said } from "./composer-drafts";
import { AssigneeMenu, Dispatching } from "./dispatching";
import { useExpectSnapshot, usePendingSnapshot } from "./expecting";
import { TaskCard } from "./queued-card";
import { WaitingPanel } from "./queued-status";
import { Refusal, type Refuse, useRefusal } from "./refusal";
import { SignalBar } from "./signal-card";
import { shownStage } from "./todo-queue";
import { type BarAction, BarButton, BELOW_BAR, TopBar } from "./top-bar";

const NO_MESSAGES: ThreadMessageLike[] = [];

/**
 * What a queued task's page shows above its composer: who queued it when an
 * agent did, the task, and what holds it back or where it stands in line.
 */
export function QueuedTaskCards({ todo }: { todo: TaskRecord }): JSX.Element {
	const { todos } = useContext(Board);
	const blocked = shownStage(todo, todos) === "blocked";
	return (
		<div className="flex flex-col gap-3">
			<AgentQueuedBanner todo={todo} />
			<TaskCard todo={todo} />
			{todo.closesOn !== undefined ? null : blocked ? (
				<BlockersCard task={todo} label="Blocked" />
			) : (
				<WaitingPanel todo={todo} />
			)}
		</div>
	);
}

/**
 * The page of a queued task, which has no conversation yet: the task, what
 * holds it back or where it stands in the queue, and the thread's own
 * composer, whose picker chooses the agent and whose messages start a live
 * conversation in place, with a way to put it back on the board.
 */
export function QueuedTask({
	id,
	onBack,
	onLeft,
	onStarted,
}: {
	id: number;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
	/** Where to go once the task is no longer queued. */
	onLeft: () => void;
	/** Opens the conversation started from this page in place. */
	onStarted?: (id: string) => void;
}): JSX.Element {
	const { todos } = useContext(Board);
	const expect = useExpectSnapshot();
	const pending = usePendingSnapshot(`todo:${id}`);
	const { refusal, refuse } = useRefusal();
	const todo = todos.find((each) => each.id === id);
	const leading = onBack !== null && (
		<BarButton label="Back to conversations" onClick={onBack}>
			<ChevronLeftIcon />
		</BarButton>
	);
	if (
		todo === undefined ||
		todo.takenBy !== null ||
		todo.stage === "available"
	) {
		return (
			<>
				<TopBar leading={leading} title="No longer queued" />
				<p className="text-muted-foreground text-sm max-md:px-3">
					The task was unqueued, or an agent has taken it.
				</p>
			</>
		);
	}
	const putBack = () =>
		void expect(queued(id, false), queueTodo(id, false)).then(onLeft, (error) =>
			refuse("Not unqueued", error),
		);
	return (
		<section
			aria-label={`queued task ${id}`}
			className={cn(
				"@container bg-background flex min-h-0 min-w-0 flex-col",
				onBack === null ? cn(BELOW_BAR, "gap-3") : "h-full gap-1",
			)}
		>
			<TopBar
				leading={leading}
				title={todo.subject}
				actions={[
					{
						label: "Unqueue",
						icon: <ListXIcon aria-hidden />,
						text: "Unqueue",
						run: pending ? undefined : putBack,
						busy: pending,
					},
				]}
			/>
			<div className="relative min-h-0 flex-1">
				<QueuedThread
					todo={todo}
					refusal={refusal}
					refuse={refuse}
					onStarted={onStarted}
				/>
			</div>
		</section>
	);
}

/**
 * The thread's own composer under the task: any message sent there starts a
 * live conversation linked to the queued task, staying in place under the task
 * and status cards until the queue hands the worktree to that same conversation.
 */
function QueuedThread({
	todo,
	refusal,
	refuse,
	onStarted,
}: {
	todo: TaskRecord;
	refusal: string | null;
	refuse: (title: string, error: unknown) => void;
	onStarted?: (id: string) => void;
}): JSX.Element {
	const expect = useExpectSnapshot();
	const adapters = useAdapters();
	const [starting, setStarting] = useState(false);
	const dispatching = useContext(Dispatching);
	const runtime = useExternalStoreRuntime({
		messages: NO_MESSAGES,
		convertMessage: (message: ThreadMessageLike) => message,
		adapters,
		onNew: async (message) => {
			const words = said(message);
			const files = filesOf(message);
			if (words === "" && files.length === 0) {
				return;
			}
			if (dispatching === null) {
				return;
			}
			setStarting(true);
			await dispatching.dispatch
				.talk(todo.id, words, todo.assignee ?? undefined, {
					title: todo.subject,
					files,
				})
				.then((id) => (onStarted ?? dispatching.open)(id))
				.catch((error: unknown) => {
					runtime.thread.composer.setText(words);
					for (const file of files) {
						void runtime.thread.composer.addAttachment(file);
					}
					refuse("Not started", error);
				})
				.finally(() => setStarting(false));
		},
	});
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<Composing.Provider value={runtime.thread.composer}>
				<ThreadView
					docked
					welcomeAtTop
					welcome={<QueuedTaskCards todo={todo} />}
					above={
						<>
							{todo.closesOn !== undefined && (
								<SignalBar wait={closingWait(todo.closesOn)} />
							)}
							<Refusal refusal={refusal} className="px-2" />
						</>
					}
					controls={
						<AssigneeMenu
							assignee={todo.assignee ?? null}
							onPick={(pick) =>
								void expect(
									assigned(todo.id, pick),
									assignTodo(todo.id, pick),
								).catch((error: unknown) => refuse("Not assigned", error))
							}
						/>
					}
					placeholder="Talk about this task while it waits"
					starting={starting}
				/>
			</Composing.Provider>
		</AssistantRuntimeProvider>
	);
}

/**
 * The queued task header action, cards, and signal bar for a live conversation
 * opened on a queued task; empty once the task starts or leaves the queue.
 */
export function useQueuedTaskInThread(
	conversation: ConversationState,
	refused: Refuse,
): {
	todoId: number | null;
	actions: BarAction[];
	before: ReactNode;
	signal: ReactNode;
} {
	const { todos } = useContext(Board);
	const expect = useExpectSnapshot();
	const todo =
		conversation.queuedTask === null || conversation.task !== null
			? null
			: (todos.find(
					(each) =>
						each.id === conversation.queuedTask &&
						each.takenBy === null &&
						each.stage === "queued",
				) ?? null);
	const pending = usePendingSnapshot(todo === null ? "" : `todo:${todo.id}`);
	if (todo === null) {
		// A running agent-queued task's conversation shows its chain banner instead.
		return { todoId: null, actions: [], before: undefined, signal: null };
	}
	return {
		todoId: todo.id,
		actions: [
			{
				label: "Unqueue",
				icon: <ListXIcon aria-hidden />,
				text: "Unqueue",
				run: pending
					? undefined
					: () =>
							void expect(
								queued(todo.id, false),
								queueTodo(todo.id, false),
							).catch((error: unknown) => refused("Not unqueued", error)),
				busy: pending,
			},
		],
		before: <QueuedTaskCards todo={todo} />,
		signal:
			todo.closesOn === undefined ? null : (
				<SignalBar wait={closingWait(todo.closesOn)} />
			),
	};
}

/** The wait a task that closes on a signal stands for, for the bar: it has no deadline. */
export function closingWait(closesOn: ClosesOn): SignalWait {
	return {
		id: `closes-on ${closesOn.signal}`,
		name: closesOn.signal,
		description: "Closes this task when fired",
		state: "waiting",
		startedAt: closesOn.since,
		deadline: "",
		since: closesOn.since,
	};
}

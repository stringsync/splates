import {
	AssistantRuntimeProvider,
	type ThreadMessageLike,
	useExternalStoreRuntime,
} from "@assistant-ui/react";
import type { TaskRecord } from "@splates/server/board";
import { SystemWallClock } from "core/time";
import { ChevronLeftIcon, ListXIcon } from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Thread as ThreadView } from "#web/components/assistant-ui/elements/thread.aui.tsx";
import { Composing } from "#web/composing.tsx";
import { cn } from "#web/lib/utils.ts";
import { useAdapters } from "./adapters";
import { assignTodo, queueTodo, updateTodo } from "./api";
import { blockedFix } from "./blocked-fix";
import { Board } from "./board";
import { assigned, queued } from "./board-expectations";
import { filesOf, said } from "./composer-drafts";
import { AssigneeMenu } from "./dispatching";
import { useExpectSnapshot, usePendingSnapshot } from "./expecting";
import { TaskCard } from "./queued-card";
import { addedWhileQueued } from "./queued-note";
import { BlockedPanel, WaitingPanel } from "./queued-status";
import { Refusal, useRefusal } from "./refusal";
import { shownStage } from "./todo-queue";
import { BarButton, BELOW_BAR, TopBar } from "./top-bar";

const NO_MESSAGES: ThreadMessageLike[] = [];

/**
 * The page of a queued task, which has no conversation yet: the task, what
 * holds it back or where it stands in the queue, and the thread's own
 * composer, whose picker chooses the agent and whose messages add to the
 * task, with a way to put it back on the board, out of the queue.
 */
export function QueuedTask({
	id,
	onBack,
	onLeft,
}: {
	id: number;
	/** Back to the list, on a phone; null beside a sidebar. */
	onBack: (() => void) | null;
	/** Where to go once the task is no longer queued. */
	onLeft: () => void;
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
				"flex min-h-0 min-w-0 flex-col gap-3",
				onBack === null ? BELOW_BAR : "h-full",
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
			<QueuedThread
				todo={todo}
				changing={pending}
				refusal={refusal}
				refuse={refuse}
			/>
		</section>
	);
}

/**
 * The thread's own composer under the task: a message sent there is added to
 * the task's words, for the agent that takes it to read, and its picker
 * chooses the agent, which the task's card then shows.
 */
function QueuedThread({
	todo,
	changing,
	refusal,
	refuse,
}: {
	todo: TaskRecord;
	/** A new assignee is on its way to the server. */
	changing: boolean;
	refusal: string | null;
	refuse: (title: string, error: unknown) => void;
}): JSX.Element {
	const { todos } = useContext(Board);
	const expect = useExpectSnapshot();
	const adapters = useAdapters();
	const [adding, setAdding] = useState(false);
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
			setAdding(true);
			await updateTodo(todo.id, {
				subject: todo.subject,
				text: addedWhileQueued(todo.text, words, new SystemWallClock().now()),
				files,
				keep: todo.files,
			})
				.catch((error: unknown) => {
					// The words back in the composer, to send again.
					runtime.thread.composer.setText(words);
					for (const file of files) {
						void runtime.thread.composer.addAttachment(file);
					}
					refuse("Not added", error);
				})
				.finally(() => setAdding(false));
		},
	});
	const fix = blockedFix(todo, todos);
	const blocked = shownStage(todo, todos) === "blocked";
	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<Composing.Provider value={runtime.thread.composer}>
				<ThreadView
					docked
					welcomeAtTop
					welcome={
						<div className="flex flex-col gap-3">
							<TaskCard todo={todo} changing={changing} />
							{blocked ? (
								<BlockedPanel todo={todo} fix={fix} />
							) : (
								<WaitingPanel todo={todo} />
							)}
						</div>
					}
					above={<Refusal refusal={refusal} className="px-2" />}
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
					placeholder="Add to this task before an agent takes it"
					starting={adding}
				/>
			</Composing.Provider>
		</AssistantRuntimeProvider>
	);
}

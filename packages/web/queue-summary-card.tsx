import type { ConversationState } from "@splates/server/conversations";
import type { TaskReport } from "@splates/server/plans";
import { createContext, type JSX, useContext, useRef } from "react";
import { Board } from "./board";
import { lastReport, reportedAs } from "./conversation-names";
import { OwnQueueCard } from "./permission-card";

/** The numbers of the tasks a conversation added, oldest first, each once. */
export function addedTasks(
	conversation: Pick<ConversationState, "events">,
): number[] {
	const added: number[] = [];
	for (const event of conversation.events) {
		if (
			event.action === "task add" &&
			event.reason === null &&
			!added.includes(event.number)
		) {
			added.push(event.number);
		}
	}
	return added;
}

/** The conversation whose thread is drawn, so a report can show its queue card. */
export const QueueSummaryFor = createContext<ConversationState | null>(null);

/**
 * The queue card of the tasks a conversation added, drawn in the thread right
 * below the report that ended it, never pinned above the composer.
 */
export function QueueSummaryAfter({
	report,
}: {
	report: TaskReport;
}): JSX.Element | null {
	const conversation = useContext(QueueSummaryFor);
	const last = conversation === null ? null : lastReport(conversation);
	if (
		conversation === null ||
		last === null ||
		last.ending !== report.ending ||
		last.task !== report.task ||
		last.reason !== report.reason
	) {
		return null;
	}
	return <QueueSummaryCard conversation={conversation} />;
}

/**
 * Once a conversation has reported its ending, a card of the tasks it added
 * that are still on the board and not started, to queue one by one or all at
 * once. It appears only while one waits to be queued, then stays to show them
 * queued.
 */
export function QueueSummaryCard({
	conversation,
}: {
	conversation: ConversationState;
}): JSX.Element | null {
	const { todos } = useContext(Board);
	const shown = useRef(false);
	const ids = addedTasks(conversation).filter((id) =>
		todos.some((todo) => todo.id === id && todo.takenBy === null),
	);
	const pending = ids.some(
		(id) => todos.find((todo) => todo.id === id)?.stage === "available",
	);
	if (reportedAs(conversation) === null || ids.length === 0) {
		return null;
	}
	if (pending) {
		shown.current = true;
	}
	if (!shown.current) {
		return null;
	}
	return (
		<OwnQueueCard
			perTask
			proposal={{
				action: "queue",
				lane: null,
				tasks: ids,
				title: "tasks added in this conversation",
				body: "",
			}}
		/>
	);
}

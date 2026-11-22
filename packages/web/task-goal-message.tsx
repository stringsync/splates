import { type JSX, useContext } from "react";
import { Board } from "./board";
import { queueStartOf } from "./queue-start";
import { TaskCard } from "./queued-card";

/**
 * Shows the task as its card, at the top of a conversation the queue
 * started. Pass the start message's text; nothing shows for any other text.
 */
export function QueueGoal({ text }: { text: string }): JSX.Element | null {
	const board = useContext(Board);
	const start = queueStartOf(text);
	if (start === null) {
		return null;
	}
	const todo = board.todos.find((each) => each.id === start.queued);
	if (todo === undefined) {
		return null;
	}
	return (
		<div data-slot="task-goal-message" className="my-4">
			<TaskCard todo={todo} />
		</div>
	);
}

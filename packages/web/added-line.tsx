import type { TaskRecord } from "@stringsync/splates-server/board";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { removeTodo, restoreTodo } from "./api";
import { Board } from "./board";
import { todoRemoved, todoRestored } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { Refusal, useRefusal } from "./refusal";
import { type Act, SplatesEvent, type SplatesEventView } from "./splates-event";

/** A todo's "Added" line, with Remove, then Undo, while the todo is still free to remove. */
export function AddedLine({
	view,
	id,
	render = (event) => <SplatesEvent event={event} />,
}: {
	view: SplatesEventView;
	id: number;
	render?: (event: SplatesEventView) => ReactNode;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	// The todo as it stood when removed, to show back in place on Undo.
	const [removed, setRemoved] = useState<TaskRecord | null>(null);
	const { refusal, attempt } = useRefusal();
	const live = board.todos.find((todo) => todo.id === id);
	// Each shows at once; refused, the line goes back to what it said.
	const run = (
		expectation: (snapshot: Snapshot) => Snapshot,
		write: Promise<void>,
		failed: string,
		after: TaskRecord | null,
	) => {
		const before = removed;
		setRemoved(after);
		void attempt(expect(expectation, write), failed).then((landed) => {
			if (!landed) {
				setRemoved(before);
			}
		});
	};
	const act: Act | null =
		removed !== null
			? {
					label: "Undo",
					run: () =>
						run(todoRestored(removed), restoreTodo(id), "Not put back", null),
				}
			: live !== undefined && live.takenBy === null
				? {
						label: "Remove",
						run: () =>
							run(todoRemoved(id), removeTodo(id), "Not removed", live),
					}
				: null;
	return (
		<div>
			{render({
				...view,
				...(removed !== null && {
					words: ["Removed", ...view.words.slice(1)],
				}),
				act,
			})}
			<Refusal refusal={refusal} className="-mt-4 mb-6 text-center" />
		</div>
	);
}

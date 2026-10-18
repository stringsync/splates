import type { TodoState } from "@stringsync/splates-server/board";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { type JSX, useContext, useState } from "react";
import { removeTodo, restoreTodo } from "./api";
import { Board } from "./board";
import { todoRemoved, todoRestored } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { Refusal, useRefusal } from "./refusal";
import { type Act, SplatesEvent, type SplatesEventView } from "./splates-event";

/**
 * A todo's "Added" line, with Remove while the todo is on the list and no
 * task has taken it, so one added without asking, as a merge adds what it
 * found, goes in a click; once removed from here, Undo puts it back as it
 * stood, for as long as the page stays open.
 */
export function AddedLine({
	view,
	id,
}: {
	view: SplatesEventView;
	id: number;
}): JSX.Element {
	const board = useContext(Board);
	const expect = useExpectSnapshot();
	// The todo as it stood when removed, to show back in place on Undo.
	const [removed, setRemoved] = useState<TodoState | null>(null);
	const { refusal, attempt } = useRefusal();
	const live = board.todos.find((todo) => todo.id === id);
	// Each shows at once; refused, the line goes back to what it said.
	const run = (
		expectation: (snapshot: Snapshot) => Snapshot,
		write: Promise<void>,
		failed: string,
		after: TodoState | null,
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
			<SplatesEvent
				event={{
					...view,
					...(removed !== null && {
						words: ["Removed", ...view.words.slice(1)],
					}),
					act,
				}}
			/>
			<Refusal refusal={refusal} className="-mt-4 mb-6 text-center" />
		</div>
	);
}

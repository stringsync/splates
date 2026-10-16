import { type JSX, useContext, useState } from "react";
import { removeTodo, restoreTodo } from "./api";
import { type Act, ArborEvent, type ArborEventView } from "./arbor-event";
import { Board } from "./board";
import { Refusal, useRefusal } from "./refusal";

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
	view: ArborEventView;
	id: number;
}): JSX.Element {
	const board = useContext(Board);
	const [removed, setRemoved] = useState(false);
	const [busy, setBusy] = useState(false);
	const { refusal, attempt } = useRefusal();
	const live = board.todos.find((todo) => todo.id === id);
	const run = async (write: Promise<void>, failed: string, after: boolean) => {
		setBusy(true);
		if (await attempt(write, failed)) {
			setRemoved(after);
		}
		setBusy(false);
	};
	const act: Act | null = busy
		? null
		: removed
			? {
					label: "Undo",
					run: () => run(restoreTodo(id), "Not put back", false),
				}
			: live !== undefined && live.takenBy === null
				? {
						label: "Remove",
						run: () => run(removeTodo(id), "Not removed", true),
					}
				: null;
	return (
		<div>
			<ArborEvent
				event={{
					...view,
					...(removed && { words: ["Removed", ...view.words.slice(1)] }),
					act,
				}}
			/>
			<Refusal refusal={refusal} className="-mt-4 mb-6 text-center" />
		</div>
	);
}

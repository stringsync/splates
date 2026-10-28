import type { TaskRecord } from "@stringsync/splates-server/board";
import type { Snapshot } from "@stringsync/splates-server/tasks";
import { type JSX, type ReactNode, useContext, useState } from "react";
import { removeTodo, restoreTodo } from "./api";
import { Board } from "./board";
import { todoRemoved, todoRestored } from "./board-expectations";
import { Button } from "./components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "./components/ui/popover";
import { useExpectSnapshot } from "./expecting";
import { Refusal, useRefusal } from "./refusal";
import {
	type Act,
	Action,
	SplatesEvent,
	type SplatesEventView,
} from "./splates-event";

/** Shows an added task as one subject. Open it to view the task, remove it, or undo removal. */
export function AddedLine({
	view,
	id,
	render = (event, subject) => (
		<SplatesEvent event={event}>{subject}</SplatesEvent>
	),
}: {
	view: SplatesEventView;
	id: number;
	render?: (event: SplatesEventView, subject?: ReactNode) => ReactNode;
}): JSX.Element {
	const board = useContext(Board);
	const [opened, setOpened] = useState(false);
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
	const subject = live ?? removed;
	const verb = removed !== null ? "Removed" : "Added";
	return (
		<div>
			{act === null || subject === null ? (
				render(view)
			) : (
				<Popover open={opened} onOpenChange={setOpened}>
					{render(
						{ ...view, words: [verb], act: null },
						<PopoverTrigger
							render={
								<Button
									variant="outline"
									size="xs"
									className="min-w-0 shrink"
								/>
							}
							title={`Task #${id}: ${subject.subject}`}
						>
							<span className="min-w-0 truncate">
								#{id} {subject.subject}
							</span>
						</PopoverTrigger>,
					)}
					<PopoverContent className="flex w-72 flex-col gap-3">
						<p className="text-sm wrap-anywhere">{subject.subject}</p>
						{live !== undefined && (
							<Button
								variant="ghost"
								onClick={() => {
									setOpened(false);
									board.open(id);
								}}
							>
								Open task #{id}
							</Button>
						)}
						<Action act={act} />
					</PopoverContent>
				</Popover>
			)}

			<Refusal refusal={refusal} className="-mt-4 mb-6 text-center" />
		</div>
	);
}

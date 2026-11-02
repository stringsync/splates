import { ChevronLeftIcon, HourglassIcon, ListXIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { queueTodo } from "./api";
import { blockedFix } from "./blocked-fix";
import { Board } from "./board";
import { queued } from "./board-expectations";
import { useExpectSnapshot, usePendingSnapshot } from "./expecting";
import { QueueBlockersCta } from "./queue-blockers";
import { Refusal, useRefusal } from "./refusal";
import { stageLabel } from "./todo-queue";
import { BarButton, TopBar } from "./top-bar";
import { waitLines, waitsOn } from "./waits-on";

/**
 * The page of a queued task, which has no conversation yet: what it is, where
 * it stands in the queue and what it waits on, with a way to put it back on
 * the board, out of the queue.
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
	const { todos, lanes } = useContext(Board);
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
	const waits = waitLines(waitsOn(todo, todos, lanes));
	const fix = blockedFix(todo, todos);
	const unqueued = fix?.kind === "queue" ? fix.chain : [];
	const putBack = () =>
		void expect(queued(id, false), queueTodo(id, false)).then(onLeft, (error) =>
			refuse("Not unqueued", error),
		);
	return (
		<>
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
			<Refusal refusal={refusal} />
			<div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 max-md:px-2">
				<div className="flex flex-1 flex-col gap-4 overflow-y-auto">
					<div className="flex flex-col gap-y-2 px-2 max-sm:items-end">
						<div className="min-w-0 max-w-full wrap-anywhere whitespace-pre-wrap rounded-lg border border-foreground/15 bg-muted px-4 py-2.5 text-foreground max-sm:rounded-3xl max-sm:border-0">
							{todo.text !== "" ? todo.text : todo.subject}
						</div>
					</div>
					<div
						role="status"
						className="flex flex-col gap-1 px-2 text-muted-foreground text-sm"
					>
						<p className="flex items-center gap-2">
							<HourglassIcon
								aria-hidden
								className="size-4 animate-pulse motion-reduce:animate-none"
							/>
							{stageLabel(todo, todos)}
						</p>
						{waits !== "" && (
							<p className="whitespace-pre-line ps-6 text-xs">{waits}</p>
						)}
					</div>
					<QueueBlockersCta todo={todo} chain={unqueued} />
				</div>
				<div className="w-full pb-4 pt-2 max-md:pb-2">
					<div
						aria-disabled
						className="flex min-h-14 w-full cursor-not-allowed items-center rounded-(--composer-radius) border border-foreground/10 bg-(--composer-bg) p-(--composer-padding) opacity-60"
					>
						<span className="px-2.5 text-base text-muted-foreground/70">
							An agent will pick this up. Unqueue it to edit.
						</span>
					</div>
				</div>
			</div>
		</>
	);
}

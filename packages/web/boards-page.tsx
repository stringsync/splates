import { lanes, named } from "@splates/server/board/browser";
import type { Snapshot } from "@splates/server/tasks";
import { savedBoard } from "./board-places";
import { BoardSwitcher } from "./board-switcher";
import { QUEUE_BOARD_WHY } from "./queue-column";
import { stageOf } from "./todo-queue";
import { TopBar } from "./top-bar";

/** Render a project’s board index. Pass its snapshot and an onPick callback to open a selected board. */
export function BoardsPage({
	snapshot,
	onPick,
	onQueue,
}: {
	snapshot: Snapshot;
	onPick: () => void;
	/** Opens the Queue, the board every project has and no one edits. */
	onQueue?: () => void;
}) {
	const all = lanes(snapshot.todos, named(snapshot.todos, snapshot.lanes));
	const queuedCount = snapshot.todos.filter(
		(todo) => stageOf(todo) === "queued",
	).length;
	return (
		<section aria-label="Boards" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Boards" />
			<div>
				<p className="text-muted-foreground text-sm">
					Choose a board or create a new one.
				</p>
			</div>
			<BoardSwitcher
				mode="index"
				builtIn={
					onQueue === undefined ? undefined : (
						<li className="flex min-h-16 items-center gap-2 py-2">
							<span aria-hidden className="w-4 shrink-0" />
							<button
								type="button"
								onClick={onQueue}
								title={QUEUE_BOARD_WHY}
								className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
							>
								<span className="truncate">Queue</span>
								<span className="ml-auto text-muted-foreground text-xs tabular-nums">
									{queuedCount}
								</span>
							</button>
							<span aria-hidden className="size-8 shrink-0 max-md:size-11" />
						</li>
					)
				}
				boards={snapshot.boards ?? []}
				current={savedBoard() ?? -1}
				tasks={(snapshot.boards ?? []).map((board) => {
					const own = all.filter(
						(lane) => (lane.board ?? snapshot.boards?.[0]?.id) === board.id,
					);
					return {
						id: board.id,
						lanes: own.map((lane) => lane.id),
						tasks: own.flatMap((lane) => lane.todos),
					};
				})}
				onPick={onPick}
			/>
		</section>
	);
}

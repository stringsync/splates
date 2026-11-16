import { lanes, named } from "@splates/server/board/browser";
import type { Snapshot } from "@splates/server/tasks";
import { ListOrderedIcon } from "lucide-react";
import { savedBoard } from "./board-places";
import { BoardSwitcher } from "./board-switcher";
import { BoardTile } from "./board-tile";
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
	const queued = snapshot.todos.filter((todo) => stageOf(todo) === "queued");
	return (
		<section aria-label="Boards" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Boards" />
			<BoardSwitcher
				mode="index"
				builtIn={
					onQueue === undefined ? undefined : (
						<li className="list-none">
							<BoardTile
								id={0}
								name="Queue"
								icon={<ListOrderedIcon className="size-4 shrink-0" />}
								title={QUEUE_BOARD_WHY}
								tasks={queued}
								onOpen={onQueue}
							/>
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

import { lanes, named } from "@splates/server/board/browser";
import type { Snapshot } from "@splates/server/tasks";
import { savedBoard } from "./board-places";
import { BoardSwitcher } from "./board-switcher";
import { TopBar } from "./top-bar";

/** Render a project’s board index. Pass its snapshot and an onPick callback to open a selected board. */
export function BoardsPage({
	snapshot,
	onPick,
}: {
	snapshot: Snapshot;
	onPick: () => void;
}) {
	const all = lanes(snapshot.todos, named(snapshot.todos, snapshot.lanes));
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

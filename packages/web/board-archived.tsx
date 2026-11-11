import type { BoardRecord } from "@splates/server/board/browser";
import { RotateCcwIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";

/** The archived boards, each with a Restore button; nothing when there are none. */
export function ArchivedBoards({
	boards,
	onRestore,
}: {
	boards: BoardRecord[];
	onRestore: (board: BoardRecord) => void;
}): JSX.Element | null {
	if (boards.length === 0) {
		return null;
	}
	return (
		<section aria-label="Archived boards" className="flex flex-col">
			<h3 className="pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Archived
			</h3>
			<ul className="flex flex-col">
				{boards.map((board) => (
					<li key={board.id} className="flex items-center gap-1">
						<span className="min-w-0 flex-1 truncate px-2 text-muted-foreground">
							{board.name}
						</span>
						<Button
							size="sm"
							variant="ghost"
							aria-label={`Restore ${board.name}`}
							onClick={() => onRestore(board)}
						>
							<RotateCcwIcon />
							Restore
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

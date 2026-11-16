import { type BoardRecord, DEFAULT_BOARD } from "@splates/server/board/browser";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";

/**
 * A board's ⋯ menu: rename it, move it up or down among the others, or
 * delete it. The default board offers only rename and moves. `onTile`
 * draws the button for a colored board tile.
 */
export function BoardMenu({
	board,
	onTile,
	canMove,
	first,
	last,
	onRename,
	onShift,
	onDelete,
}: {
	board: BoardRecord;
	onTile: boolean;
	canMove: boolean;
	first: boolean;
	last: boolean;
	onRename: () => void;
	onShift: (by: -1 | 1) => void;
	onDelete: () => void;
}): JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon"
						variant="ghost"
						aria-label={`${board.name} actions`}
						title="Board actions"
						className={
							onTile
								? "size-7 text-white/90 hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 aria-expanded:text-white max-md:size-9"
								: "max-md:size-11"
						}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canMove || first}
					onClick={() => onShift(-1)}
				>
					<ArrowUpIcon />
					Move up
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canMove || last}
					onClick={() => onShift(1)}
				>
					<ArrowDownIcon />
					Move down
				</DropdownMenuItem>
				{board.id === DEFAULT_BOARD ? null : (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onClick={onDelete}>
							<Trash2Icon />
							Delete…
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

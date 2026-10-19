import type { LaneState } from "@stringsync/splates-server/board";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	MergeIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Undo2Icon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { cn } from "#web/lib/utils.ts";
import { dropLane, joinLanes } from "./api";
import { Board, still, touchItems } from "./board";
import { laneDropped, lanesJoined } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";

/** What can be done to a whole lane: rename it, move it, fold it into another, or remove it. */
export function LaneMenu({
	lane,
	lanes,
	onRename,
}: {
	lane: LaneState;
	lanes: LaneState[];
	onRename: () => void;
}): JSX.Element {
	const { moveLane, refuseLane } = useContext(Board);
	const expect = useExpectSnapshot();
	const others = lanes.filter((other) => other.id !== lane.id);
	const at = lanes.findIndex((other) => other.id === lane.id);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label={`${lane.name} actions`}
						className="pointer-coarse:size-10"
						{...still}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className={cn("w-64", touchItems)}>
				<DropdownMenuItem onClick={onRename}>
					<PencilIcon />
					Rename
				</DropdownMenuItem>
				{others.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={at === 0}
							onClick={() => moveLane(lane.id, at)}
						>
							<ArrowLeftIcon />
							Move left
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={at === lanes.length - 1}
							onClick={() => moveLane(lane.id, at + 2)}
						>
							<ArrowRightIcon />
							Move right
						</DropdownMenuItem>
					</>
				)}
				{others.length > 0 && lane.todos.length > 0 && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuLabel>
								Move its tasks to the end of
							</DropdownMenuLabel>
							{others.map((other) => (
								<DropdownMenuItem
									key={other.id}
									onClick={() =>
										void expect(
											lanesJoined(lane.id, other.id),
											joinLanes(lane.id, other.id),
										).catch((error: unknown) =>
											refuseLane(lane.id, "Not moved", error),
										)
									}
								>
									<MergeIcon />
									{other.name}
								</DropdownMenuItem>
							))}
						</DropdownMenuGroup>
					</>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() =>
						void expect(laneDropped(lane.id), dropLane(lane.id)).catch(
							(error: unknown) =>
								refuseLane(lane.id, "Lane not removed", error),
						)
					}
				>
					<Undo2Icon />
					{lane.todos.length === 0
						? "Remove lane"
						: "Remove lane, untriage its tasks"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

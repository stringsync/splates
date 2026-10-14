import {
	ArrowLeftIcon,
	ArrowRightIcon,
	CheckIcon,
	CopyIcon,
	MergeIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Undo2Icon,
} from "lucide-react";
import { type JSX, useContext } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import type { LaneState } from "../lanes";
import { laneReference } from "../prompts";
import { dropLane, joinLanes } from "./api";
import { Board, still } from "./board";
import { copiedLabel, useCopy } from "./card";

/** What can be done to a whole lane: start it, rename it, move it, fold it into another, or remove it. */
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
	const { copied, copy } = useCopy();
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
						{...still}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-64">
				<DropdownMenuItem
					closeOnClick={false}
					title={copied.state === "failed" ? copied.error : undefined}
					onClick={() => copy(laneReference(lane.id))}
				>
					{copied.state === "copied" ? <CheckIcon /> : <CopyIcon />}
					<span aria-live="polite">
						{copiedLabel(copied, `Copy ${laneReference(lane.id)}`)}
					</span>
				</DropdownMenuItem>
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
								Move its todos to the end of
							</DropdownMenuLabel>
							{others.map((other) => (
								<DropdownMenuItem
									key={other.id}
									onClick={() =>
										void joinLanes(lane.id, other.id).catch((error: unknown) =>
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
						void dropLane(lane.id).catch((error: unknown) =>
							refuseLane(lane.id, "Lane not removed", error),
						)
					}
				>
					<Undo2Icon />
					{lane.todos.length === 0
						? "Remove lane"
						: "Remove lane, untriage its todos"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

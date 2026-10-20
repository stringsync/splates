import type { LaneState } from "@stringsync/splates-server/board";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ListPlusIcon,
	ListXIcon,
	MergeIcon,
	MoreHorizontalIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	Trash2Icon,
} from "lucide-react";
import { type JSX, useContext, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
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
import { dropLane, joinLanes, queueLane } from "./api";
import { Board, still, touchItems } from "./board";
import { laneDropped, laneQueued, lanesJoined } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";

/**
 * What can be done to a whole lane: rename it, queue it whole, move it, fold
 * it into another, or remove it with its tasks, asking first when it has any.
 */
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
	const toggleQueued = useToggleQueued(lane);
	const others = lanes.filter((other) => other.id !== lane.id);
	const at = lanes.findIndex((other) => other.id === lane.id);
	const [asking, setAsking] = useState(false);
	const remove = () =>
		void expect(laneDropped(lane.id), dropLane(lane.id)).catch(
			(error: unknown) => refuseLane(lane.id, "Lane not removed", error),
		);
	const count = lane.todos.length;
	return (
		<>
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
					<DropdownMenuItem onClick={toggleQueued}>
						{lane.queued ? <ListXIcon /> : <ListPlusIcon />}
						{lane.queued ? "Stop queueing lane" : "Queue lane"}
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
						onClick={() => (count === 0 ? remove() : setAsking(true))}
					>
						<Trash2Icon />
						{count === 0 ? "Remove lane" : "Remove lane and its tasks"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Remove {lane.name}?</DialogTitle>
						<DialogDescription>
							{count === 1 ? "Its task is" : `Its ${count} tasks are`} removed
							with it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Cancel
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								setAsking(false);
								remove();
							}}
						>
							Remove lane and tasks
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * The lane's one tap to queue it whole, or, once queued, to stop: what its
 * menu's Queue lane does, kept in the header where it is quick to reach.
 */
export function QueueLaneButton({ lane }: { lane: LaneState }): JSX.Element {
	const toggleQueued = useToggleQueued(lane);
	return (
		<Button
			size="icon-xs"
			variant="ghost"
			aria-label={
				lane.queued ? `Stop queueing ${lane.name}` : `Queue ${lane.name}`
			}
			aria-pressed={lane.queued}
			title={lane.queued ? "Stop queueing lane" : "Queue lane"}
			className="pointer-coarse:size-10"
			onClick={toggleQueued}
			{...still}
		>
			{lane.queued ? <PauseIcon /> : <PlayIcon />}
		</Button>
	);
}

/** Queues the lane whole, or stops queueing it, shown at once. */
function useToggleQueued(lane: LaneState): () => void {
	const { refuseLane } = useContext(Board);
	const expect = useExpectSnapshot();
	return () =>
		void expect(
			laneQueued(lane.id, !lane.queued),
			queueLane(lane.id, !lane.queued),
		).catch((error: unknown) =>
			refuseLane(
				lane.id,
				lane.queued ? "Lane not unqueued" : "Lane not queued",
				error,
			),
		);
}

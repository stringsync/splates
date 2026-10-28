import type { LaneState } from "@stringsync/splates-server/board";
import { BACKLOG_LANE } from "@stringsync/splates-server/board/browser";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	ListPlusIcon,
	ListXIcon,
	MergeIcon,
	MoreHorizontalIcon,
	PencilIcon,
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
 * What can be done to a whole lane: rename it, queue its tasks or take them
 * out, move it, fold
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
	const queue = useQueueLane(lane);
	const { waiting, queued } = laneQueue(lane);
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
					{lane.id !== BACKLOG_LANE && (
						<DropdownMenuItem onClick={onRename}>
							<PencilIcon />
							Rename
						</DropdownMenuItem>
					)}
					<DropdownMenuItem
						disabled={waiting === 0}
						onClick={() => queue(true)}
					>
						<ListPlusIcon />
						{waiting === 0
							? "Queue lane"
							: `Queue lane: ${waiting} task${waiting === 1 ? "" : "s"}`}
					</DropdownMenuItem>
					{queued > 0 && (
						<DropdownMenuItem onClick={() => queue(false)}>
							<ListXIcon />
							Take lane out of queue
						</DropdownMenuItem>
					)}
					{lane.id !== BACKLOG_LANE && others.length > 0 && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								disabled={at <= 1}
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
					{lane.id !== BACKLOG_LANE &&
						others.length > 0 &&
						lane.todos.length > 0 && (
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
					{lane.id !== BACKLOG_LANE && (
						<DropdownMenuItem
							onClick={() => (count === 0 ? remove() : setAsking(true))}
						>
							<Trash2Icon />
							{count === 0 ? "Remove lane" : "Remove lane and its tasks"}
						</DropdownMenuItem>
					)}
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
 * How many of `lane`'s tasks queueing it would queue, those no agent has in
 * the backlog or ready, and how many no agent has are queued now.
 */
export function laneQueue(lane: LaneState): {
	waiting: number;
	queued: number;
} {
	const open = lane.todos.filter((todo) => todo.takenBy === null);
	return {
		waiting: open.filter(
			(todo) => todo.stage === "backlog" || todo.stage === "ready",
		).length,
		queued: open.filter((todo) => todo.stage === "queued").length,
	};
}

/** A lane header's Queue N tasks button, which queues every task waiting in the lane; absent while none waits. */
export function QueueLaneButton({
	lane,
}: {
	lane: LaneState;
}): JSX.Element | null {
	const queue = useQueueLane(lane);
	const { waiting } = laneQueue(lane);
	if (waiting === 0) {
		return null;
	}
	return (
		<Button
			size="xs"
			variant="outline"
			title={`Put the ${waiting === 1 ? "task" : `${waiting} tasks`} waiting in ${lane.name} in the queue now; each starts once what it is blocked by lands`}
			className="pointer-coarse:h-10"
			onClick={() => queue(true)}
			{...still}
		>
			<ListPlusIcon />
			Queue {waiting} {waiting === 1 ? "task" : "tasks"}
		</Button>
	);
}

/** Queues every task waiting in the lane, or takes its queued ones out, pending until the server shows it. */
function useQueueLane(lane: LaneState): (queued: boolean) => void {
	const { refuseLane } = useContext(Board);
	const expect = useExpectSnapshot();
	return (queued) =>
		void expect(laneQueued(lane.id, queued), queueLane(lane.id, queued)).catch(
			(error: unknown) =>
				refuseLane(
					lane.id,
					queued ? "Lane not queued" : "Lane not taken out",
					error,
				),
		);
}

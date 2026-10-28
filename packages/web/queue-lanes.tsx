import type { LaneRecord, TaskRecord } from "@stringsync/splates-server/board";
import { APPROVAL } from "@stringsync/splates-server/board/browser";
import type { JSX } from "react";
import { DropdownMenuItem } from "#web/components/ui/dropdown-menu.tsx";
import { approveLane, moveLane, queueLane } from "./api";
import { laneApproved, laneQueued } from "./board-expectations";
import { useExpectSnapshot } from "./expecting";
import { QueueEmpty, QueueRow, QueueSection, SortableRows } from "./queue-rows";
import { Refusal, useRefusal } from "./refusal";

/**
 * The lanes queued whole, in the board's order, dragged into another:
 * how many tasks each has left, paused from its row, or let queue more once
 * its budget runs out.
 */
export function QueuedLanes({
	lanes,
	todos,
	onOpen,
}: {
	lanes: readonly LaneRecord[];
	todos: readonly TaskRecord[];
	onOpen: (id: number) => void;
}): JSX.Element {
	const expect = useExpectSnapshot();
	const { refusal, refuse } = useRefusal();
	const queued = lanes.filter((lane) => lane.queued === true);
	const attempt = (title: string, write: Promise<unknown>) =>
		void write.catch((error: unknown) => refuse(title, error));
	// A lane's place counts among every lane on the board, from 1.
	const move = (id: string, to: number) => {
		const onto = queued[to];
		const at = onto === undefined ? -1 : lanes.indexOf(onto);
		if (at >= 0) {
			attempt("Not moved", moveLane(Number(id), at + 1));
		}
	};
	const pause = (lane: LaneRecord) =>
		attempt(
			"Lane not paused",
			expect(laneQueued(lane.id, false), queueLane(lane.id, false)),
		);
	return (
		<QueueSection title="Lanes" count={queued.length}>
			<Refusal refusal={refusal} />
			{queued.length === 0 ? (
				<QueueEmpty>No lane queued</QueueEmpty>
			) : (
				<SortableRows
					items={queued}
					idOf={(lane) => String(lane.id)}
					label="queued lanes"
					onMove={move}
					row={(lane, { grip, dragging }) => {
						const left = todos.filter((todo) => todo.lane === lane.id).length;
						const stopped = lane.budget === 0;
						const approve = {
							label: `Approve ${APPROVAL}`,
							onClick: () =>
								attempt(
									"Not approved",
									expect(
										laneApproved(lane.id, APPROVAL),
										approveLane(lane.id, APPROVAL),
									),
								),
						};
						const paused = { label: "Pause", onClick: () => pause(lane) };
						return (
							<QueueRow
								pendingKey={`lane:${lane.id}`}
								grip={grip}
								dragging={dragging}
								name={lane.name}
								by={stopped ? "budget ran out" : `${left} left`}
								id={`L${lane.id}`}
								quiet={stopped ? paused : undefined}
								main={stopped ? approve : paused}
								menu={
									<DropdownMenuItem onClick={() => onOpen(lane.id)}>
										Open lane
									</DropdownMenuItem>
								}
							/>
						);
					}}
				/>
			)}
		</QueueSection>
	);
}

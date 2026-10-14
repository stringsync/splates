import {
	type CollisionDetection,
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	KeyboardSensor,
	MouseSensor,
	pointerWithin,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { JSX, ReactNode } from "react";
import type { LaneRecord, LaneState } from "../lanes";
import type { TodoState } from "../todo";
import { Card } from "./card";
import { columnOf, LiftedLane, laneOf } from "./lanes";
import type { TodoBoard } from "./todo-board";

/**
 * Lets a card be dragged anywhere on the board: up or down its column, onto
 * a card in a lane to join it there, onto a column's space for its bottom,
 * or onto the new lane column; and a lane, by its header, left or right
 * past the others. A mouse drags once it moves a few pixels and a finger
 * after a short press, so a tap still opens the card and a swipe still
 * scrolls; a keyboard picks a card up by its grip with Space and moves it
 * with the arrows.
 */
export function BoardDrag({
	board,
	refuseTodo,
	refuseLane,
	todos,
	lanes,
	staleness,
	lifted,
	liftedLane,
	children,
}: {
	board: TodoBoard;
	/** Says on a card that it was not moved. */
	refuseTodo: (id: number, title: string, error: unknown) => void;
	/** Says under a lane's header that it was not moved. */
	refuseLane: (id: number, title: string, error: unknown) => void;
	todos: TodoState[];
	lanes: LaneRecord[];
	staleness: number;
	lifted?: TodoState;
	liftedLane?: LaneState;
	children: ReactNode;
}): JSX.Element {
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 200, tolerance: 6 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	const drop = ({ active, over }: DragEndEvent) => {
		const moving = laneOf(active.id);
		if (moving !== undefined) {
			board
				.dropLane(
					lanes,
					moving,
					over === null ? null : (laneOf(over.id) ?? null),
				)
				?.catch((error: unknown) => refuseLane(moving, "Not moved", error));
			return;
		}
		const lane = over === null ? undefined : columnOf(over.id);
		board
			.drop(
				todos,
				Number(active.id),
				over === null
					? null
					: lane === undefined
						? { card: Number(over.id) }
						: { lane },
			)
			?.catch((error: unknown) =>
				refuseTodo(Number(active.id), "Not moved", error),
			);
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={collide}
			onDragStart={({ active }) => {
				const lane = laneOf(active.id);
				if (lane === undefined) {
					board.lift(Number(active.id));
				} else {
					board.liftLane(lane);
				}
			}}
			onDragCancel={() => board.cancel()}
			onDragEnd={drop}
		>
			{children}
			{/* Lifted off the column, tilted, the way a card in hand looks: as it
			    was in its column, numbered and without its detail in a lane. */}
			<DragOverlay>
				{lifted && (
					<Card
						todo={lifted}
						staleness={staleness}
						step={
							lifted.lane === null
								? undefined
								: todos
										.filter((other) => other.lane === lifted.lane)
										.findIndex((other) => other.id === lifted.id) + 1
						}
						className="rotate-2 cursor-grabbing shadow-lg"
					/>
				)}
				{liftedLane && <LiftedLane lane={liftedLane} staleness={staleness} />}
			</DragOverlay>
		</DndContext>
	);
}

/**
 * The card under the pointer, or failing one the column, so a card dropped
 * between two lands in the column it is over; the nearest card when the
 * pointer is over neither, as when a keyboard moves it. A lane in hand
 * looks only at the other lanes, nearest first.
 */
const collide: CollisionDetection = (args) => {
	if (laneOf(args.active.id) !== undefined) {
		return closestCenter({
			...args,
			droppableContainers: args.droppableContainers.filter(
				(container) => laneOf(container.id) !== undefined,
			),
		});
	}
	const within = pointerWithin(args);
	const card = within.find((hit) => columnOf(hit.id) === undefined);
	return card ? [card] : within.length > 0 ? within : closestCenter(args);
};

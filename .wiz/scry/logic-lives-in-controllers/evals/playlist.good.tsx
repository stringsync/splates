import {
	closestCenter,
	DndContext,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { useReactive } from "@webappwiz/react";
import { useState } from "react";
import type { PlaylistOrder } from "./playlist-order";
import { TrackRow } from "./track-row";

export function Playlist({ order }: { order: PlaylistOrder }) {
	const [lifted, setLifted] = useState<string | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);
	const tracks = useReactive(order, (order) => order.shown, ["changed"]);
	const held = tracks.find((track) => track.id === lifted);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={({ active }) => setLifted(String(active.id))}
			onDragCancel={() => setLifted(null)}
			onDragEnd={({ active, over }) => {
				setLifted(null);
				if (over !== null) {
					order.drop(String(active.id), String(over.id));
				}
			}}
		>
			<SortableContext items={tracks.map((track) => track.id)}>
				<ol className="flex flex-col gap-1">
					{tracks.map((track) => (
						<TrackRow key={track.id} track={track} />
					))}
				</ol>
			</SortableContext>
			<DragOverlay>{held && <TrackRow track={held} className="shadow-md" />}</DragOverlay>
		</DndContext>
	);
}

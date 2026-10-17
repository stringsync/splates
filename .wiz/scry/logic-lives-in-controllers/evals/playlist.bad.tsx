import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, SortableContext } from "@dnd-kit/sortable";
import { useEffect, useState } from "react";
import { reorderTrack, type Track } from "./api";
import { notify } from "./notify";
import { TrackRow } from "./track-row";

export function Playlist({ tracks }: { tracks: Track[] }) {
	// The order as the listener left it, kept on screen until the next fetch
	// agrees, so a row stays where it was dropped rather than snapping back.
	const [order, setOrder] = useState<string[] | null>(null);
	const [lifted, setLifted] = useState<string | null>(null);
	useEffect(() => setOrder(null), [tracks]);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
	);
	const ids = order ?? tracks.map((track) => track.id);
	const shown = ids.flatMap((id) => tracks.filter((track) => track.id === id));
	const held = tracks.find((track) => track.id === lifted);

	const drop = ({ active, over }: DragEndEvent) => {
		setLifted(null);
		if (over === null || active.id === over.id) {
			return;
		}
		const to = ids.indexOf(String(over.id));
		setOrder(arrayMove(ids, ids.indexOf(String(active.id)), to));
		// Slots count the whole playlist, even when only one artist is listed.
		const slot = tracks.find((track) => track.id === over.id)?.slot ?? to + 1;
		reorderTrack(String(active.id), slot).catch((error: unknown) => {
			setOrder(null);
			notify(error instanceof Error ? error.message : "Could not move that track");
		});
	};

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={({ active }) => setLifted(String(active.id))}
			onDragCancel={() => setLifted(null)}
			onDragEnd={drop}
		>
			<SortableContext items={ids}>
				<ol className="flex flex-col gap-1">
					{shown.map((track) => (
						<TrackRow key={track.id} track={track} />
					))}
				</ol>
			</SortableContext>
			<DragOverlay>{held && <TrackRow track={held} className="shadow-md" />}</DragOverlay>
		</DndContext>
	);
}

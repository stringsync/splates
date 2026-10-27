import type { Cascade, Ship } from "@stringsync/splates-server/ship";
import { useEffect, useState } from "react";
import { LiveStream } from "./live-stream";

/** The cascade under way, or the last to end, with the ship publishing now. */
export type Live = { cascade: Cascade | null; ship: Ship | null };

/** The cascade as the server streams it, null until it first speaks. */
export function useLiveShips(): Live | null {
	const [live, setLive] = useState<Live | null>(null);
	useEffect(() => {
		const stream = new LiveStream("/api/ship/events", {
			message: (event) => setLive(JSON.parse(event.data) as Live),
		});
		return () => stream.dispose();
	}, []);
	return live;
}

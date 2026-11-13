/** Segments in a level meter, spanning `FLOOR_DB` to 0 dBFS. */
export const SEGMENTS = 24;
const FLOOR_DB = -60;
/** Segments above this many dBFS are yellow, and above `RED_DB` red; the rest are green. */
const YELLOW_DB = -12;
const RED_DB = -6;

export type Zone = "green" | "yellow" | "red";

/** How many of the meter's segments a peak level (linear, 0 to 1) lights. */
export function litSegments(level: number): number {
	if (!(level > 0)) {
		return 0;
	}
	const db = 20 * Math.log10(Math.min(1, level));
	const lit = Math.round(((db - FLOOR_DB) / -FLOOR_DB) * SEGMENTS);
	return Math.max(0, Math.min(SEGMENTS, lit));
}

/** The zone of the segment at this index: green for speech, yellow when it is loud, red near clipping. */
export function zoneOf(index: number): Zone {
	const db = FLOOR_DB + ((index + 1) / SEGMENTS) * -FLOOR_DB;
	if (db <= YELLOW_DB) {
		return "green";
	}
	return db <= RED_DB ? "yellow" : "red";
}

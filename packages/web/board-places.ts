/** Where the current board is kept: the URL first, then what the device last had. */
const CURRENT = "splates.board";
const STARRED = "splates.boards.starred";
const RECENT = "splates.boards.recent";

/** How many recent boards are kept. */
const RECENT_KEPT = 3;

/** The board the URL names, else the one this device last showed, else null. */
export function savedBoard(): number | null {
	const named = new URLSearchParams(location.search).get("board");
	const raw = named ?? localStorage.getItem(CURRENT);
	const id = raw === null ? Number.NaN : Number(raw);
	return Number.isInteger(id) ? id : null;
}

/** Shows board `id` in the URL and remembers it, and it among the recent. */
export function saveBoard(id: number): void {
	const url = new URL(location.href);
	url.searchParams.set("board", String(id));
	history.replaceState(history.state, "", url);
	localStorage.setItem(CURRENT, String(id));
	localStorage.setItem(
		RECENT,
		JSON.stringify([id, ...readIds(RECENT).filter((each) => each !== id)]),
	);
}

/** The boards this device starred. */
export function starredBoards(): number[] {
	return readIds(STARRED);
}

/** Stars board `id`, or takes the star off it. */
export function toggleStar(id: number): number[] {
	const stars = readIds(STARRED);
	const next = stars.includes(id)
		? stars.filter((each) => each !== id)
		: [...stars, id];
	localStorage.setItem(STARRED, JSON.stringify(next));
	return next;
}

/** The boards this device showed last, newest first. */
export function recentBoards(): number[] {
	return readIds(RECENT).slice(0, RECENT_KEPT + 1);
}

function readIds(key: string): number[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter(Number.isInteger) : [];
	} catch {
		return [];
	}
}

import { useSyncExternalStore } from "react";
import { placeKey, shownProject } from "./project-places";

/** Where the current board is kept: the URL first, then what the device last had. */
const changed = new Set<() => void>();

const CURRENT = "splates.board";
const RECENT = "splates.boards.recent";

/** How many recent boards are kept. */
const RECENT_KEPT = 3;

/** The board the URL names, else the one this device last showed, else null. */
export function savedBoard(): number | null {
	const named = new URLSearchParams(location.search).get("board");
	const raw = named ?? localStorage.getItem(currentKey());
	const id = raw === null ? Number.NaN : Number(raw);
	return Number.isInteger(id) ? id : null;
}

/** Shows board `id` in the URL and remembers it, and it among the recent. */
export function saveBoard(id: number): void {
	const url = new URL(location.href);
	url.searchParams.set("board", String(id));
	history.replaceState(history.state, "", url);
	localStorage.setItem(currentKey(), String(id));
	localStorage.setItem(
		RECENT,
		JSON.stringify([id, ...readIds(RECENT).filter((each) => each !== id)]),
	);
	for (const notify of changed) {
		notify();
	}
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

function currentKey(): string {
	return `${CURRENT}.${placeKey(shownProject())}`;
}

/** Follows board links, browser history, and selections while panels remain mounted. */
export function useSavedBoard(): number | null {
	return useSyncExternalStore(subscribe, savedBoard);
}

function subscribe(notify: () => void): () => void {
	changed.add(notify);
	window.addEventListener("popstate", notify);
	window.addEventListener("hashchange", notify);
	return () => {
		changed.delete(notify);
		window.removeEventListener("popstate", notify);
		window.removeEventListener("hashchange", notify);
	};
}

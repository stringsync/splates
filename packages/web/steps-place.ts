import type { Steps } from "@splates/server/plans/browser";
import { useCallback, useSyncExternalStore } from "react";
import { placeKey, shownProject } from "./project-places";

/**
 * Where the person is in a Steps card: how many of its steps are behind them,
 * kept in this browser only, so a reload or a pop-out picks up where they
 * were. The agent is never told.
 */
const changed = new Set<() => void>();

const PREFIX = "splates.steps";

/**
 * The key a Steps card's place is kept under: its project and its title, so
 * a newer version of it keeps the place; its words, for one with no title.
 */
export function stepsKey(steps: Steps): string {
	return `${PREFIX}.${placeKey(shownProject())}.${hashOf(
		steps.title === "" ? JSON.stringify(steps.steps) : steps.title,
	)}`;
}

/** How many steps are done, from 0 to every one; 0 when none is kept. */
export function readPlace(key: string, count: number): number {
	let raw: string | null = null;
	try {
		raw = localStorage.getItem(key);
	} catch {
		return 0;
	}
	const done = raw === null ? 0 : Number(raw);
	return Number.isInteger(done) ? Math.min(Math.max(done, 0), count) : 0;
}

export function writePlace(key: string, done: number): void {
	try {
		if (done === 0) {
			localStorage.removeItem(key);
		} else {
			localStorage.setItem(key, String(done));
		}
	} catch {
		// Private windows may refuse storage; the place then lasts the page.
	}
	for (const notify of changed) {
		notify();
	}
}

/**
 * The place in `steps` for a card or its pop-out: how many are done, `place`
 * to set it, and `move` to step on or back from where it stands.
 */
export function useStepsPlace(
	steps: Steps,
): [done: number, place: (done: number) => void, move: (by: number) => void] {
	const key = stepsKey(steps);
	const count = steps.steps.length;
	const done = useSyncExternalStore(subscribe, () => readPlace(key, count));
	const place = useCallback(
		(next: number) => writePlace(key, Math.min(Math.max(next, 0), count)),
		[key, count],
	);
	// From what is kept now, not this render's, so quick presses each count.
	const move = useCallback(
		(by: number) => place(readPlace(key, count) + by),
		[key, count, place],
	);
	return [done, place, move];
}

function subscribe(notify: () => void): () => void {
	changed.add(notify);
	// Another tab of the page moving the same place.
	addEventListener("storage", notify);
	return () => {
		changed.delete(notify);
		removeEventListener("storage", notify);
	};
}

/** FNV-1a, as hex: short and stable, not secret. */
function hashOf(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

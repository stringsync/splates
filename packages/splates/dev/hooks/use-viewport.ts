import { useSyncExternalStore } from "react";

/**
 * What of the page a phone shows: what its keyboard and Safari's bars leave,
 * which a screen pinned to it keeps its composer just above the keyboard in.
 */
export interface Viewport {
	/** How far down the page it starts, as Safari pans to what is focused. */
	top: number;
	height: number;
	/** Whether a keyboard is up, which covers the home indicator's inset. */
	keyboard: boolean;
}

/** The part of the page a phone shows, following it as the keyboard comes and goes. */
export function useViewport(): Viewport {
	return useSyncExternalStore(subscribe, read);
}

// One object per size, as useSyncExternalStore asks: a new one each read
// would render forever.
let last: Viewport = { top: 0, height: 0, keyboard: false };

function read(): Viewport {
	const top = window.visualViewport?.offsetTop ?? 0;
	const height = window.visualViewport?.height ?? innerHeight;
	// A keyboard takes far more than Safari's bars ever do.
	const keyboard = innerHeight - height > 120;
	if (
		top !== last.top ||
		height !== last.height ||
		keyboard !== last.keyboard
	) {
		last = { top, height, keyboard };
	}
	return last;
}

function subscribe(changed: () => void): () => void {
	const viewport = window.visualViewport;
	viewport?.addEventListener("resize", changed);
	viewport?.addEventListener("scroll", changed);
	addEventListener("resize", changed);
	return () => {
		viewport?.removeEventListener("resize", changed);
		viewport?.removeEventListener("scroll", changed);
		removeEventListener("resize", changed);
	};
}

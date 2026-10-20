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

// The tallest the page has shown at a width, so turning the phone starts
// over: newer iOS shrinks `innerHeight` with the keyboard too, so it alone
// would never see the keyboard, and the screen would stay put as Safari pans
// past it to what is focused.
let tallest = { width: 0, height: 0 };

function read(): Viewport {
	const offset = window.visualViewport?.offsetTop ?? 0;
	const height = window.visualViewport?.height ?? innerHeight;
	if (tallest.width !== innerWidth) {
		tallest = { width: innerWidth, height: 0 };
	}
	tallest.height = Math.max(tallest.height, height, innerHeight);
	// A keyboard takes far more than Safari's bars ever do.
	const keyboard = tallest.height - height > 120;
	// Only a keyboard's pan moves the screen. Safari's rubber band at either
	// end of the page also moves the visual viewport, and a screen that
	// followed it would slide with the page, so a drag seems to run backwards.
	const top = keyboard ? Math.max(0, offset) : 0;
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

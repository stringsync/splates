import { useSyncExternalStore } from "react";

/** A phone or tablet: its main pointer is a finger, as `pointer-coarse:` styles. */
export const TOUCH = "(pointer: coarse)";

/**
 * Whether the page is on a touch device, where keyboard shortcuts go unshown
 * and the composer waits to be tapped, following it as it changes.
 */
export function useTouch(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(TOUCH);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(TOUCH).matches,
	);
}

/**
 * Focuses `stop`, as the page does for whatever comes up to be answered,
 * unless on a touch device that would raise a keyboard the person never
 * asked for: there, only a tap brings one up, or Enter while one is up.
 */
export function focusStop(
	stop: HTMLElement | null | undefined,
	opts?: FocusOptions,
): void {
	const unasked =
		matchMedia(TOUCH).matches &&
		raises(stop) &&
		!raises(document.activeElement);
	if (stop != null && !unasked) {
		stop.focus(opts);
	}
}

/** Whether focusing `element` brings up a touch screen's keyboard. */
function raises(element: Element | null | undefined): boolean {
	return (
		element instanceof HTMLTextAreaElement ||
		(element instanceof HTMLInputElement &&
			!["button", "checkbox", "radio", "submit", "reset"].includes(
				element.type,
			)) ||
		(element instanceof HTMLElement && element.isContentEditable)
	);
}

import { useSyncExternalStore } from "react";

/** A phone or tablet: its main pointer is a finger, as `pointer-coarse:` styles. */
const TOUCH = "(pointer: coarse)";

/**
 * Whether the page is on a touch device, where keyboard shortcuts go unshown,
 * following it as it changes.
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

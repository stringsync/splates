import { useSyncExternalStore } from "react";

/** Wide enough for a sidebar: a laptop, or a tablet held sideways. */
export const WIDE = "(min-width: 768px)";

/** Whether the window is `WIDE` right now, following it as it resizes. */
export function useWide(): boolean {
	return useSyncExternalStore(
		(changed) => {
			const query = matchMedia(WIDE);
			query.addEventListener("change", changed);
			return () => query.removeEventListener("change", changed);
		},
		() => matchMedia(WIDE).matches,
	);
}

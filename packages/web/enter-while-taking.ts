import { useEffect, useRef } from "react";

/**
 * Hands `enter` an Enter pressed on the bare page while `live`, such as
 * mid-dictation; it returns whether it took the key.
 */
export function useEnterWhileTaking(live: boolean, enter: () => boolean): void {
	// A take makes its box inert, which drops the focus to the page, so Enter
	// never reaches the box.
	const latest = useRef(enter);
	latest.current = enter;
	useEffect(() => {
		if (!live) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (
				event.key === "Enter" &&
				!event.shiftKey &&
				!event.isComposing &&
				(event.target === document.body ||
					event.target === document.documentElement) &&
				latest.current()
			) {
				event.preventDefault();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [live]);
}

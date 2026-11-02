import { type RefObject, useEffect, useRef } from "react";

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

/**
 * Makes Enter in a card's last box do the card's primary action, `primary`,
 * and returns the box's `onKeyDown`. Mid-dictation the box is inert and Enter
 * lands on the bare page, so it is caught there too; `primary` finishes the
 * take first. Shift+Enter stays a new line.
 */
export function useEnterDoes(
	panel: RefObject<HTMLElement | null>,
	primary: (() => void) | null,
): (event: globalThis.KeyboardEvent) => void {
	useEnterWhileTaking(primary !== null, () => {
		if (
			primary === null ||
			panel.current?.querySelector("[data-dictation-owner]") == null
		) {
			return false;
		}
		primary();
		return true;
	});
	return (event) => {
		if (primary !== null && event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			primary();
		}
	};
}

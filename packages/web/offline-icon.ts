import { useEffect } from "react";

/** The page's tree, drawn gray and faded: `index.html` has it in color. */
const OFFLINE_ICON =
	"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><filter id='gray'><feColorMatrix type='saturate' values='0'/></filter><text y='26' font-size='28' filter='url(%23gray)' opacity='0.5'>🍽️</text></svg>";

/**
 * Grays the tab's icon while the server is `offline`, so the tab says so too,
 * for whoever has the page in the background.
 */
export function useOfflineIcon(offline: boolean): void {
	useEffect(() => {
		const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (icon === null || !offline) {
			return;
		}
		const online = icon.href;
		icon.href = OFFLINE_ICON;
		return () => {
			icon.href = online;
		};
	}, [offline]);
}

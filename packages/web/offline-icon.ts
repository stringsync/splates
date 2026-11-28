import { useEffect } from "react";

/** The stacked-plate buddy dimmed with closed sleeping eyes: `index.html` has it awake. */
const OFFLINE_ICON =
	"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' opacity='0.55'%3E%3Crect x='4' y='11' width='24' height='17' rx='6' fill='%2318181d' stroke='rgba(255,255,255,0.14)' stroke-width='1.2'/%3E%3Crect x='3' y='6' width='26' height='19' rx='6.5' fill='%232c2c34' stroke='rgba(255,255,255,0.22)' stroke-width='1.2'/%3E%3Cline x1='11.5' y1='15.5' x2='14.5' y2='15.5' stroke='%23a1a1aa' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='17.5' y1='15.5' x2='20.5' y2='15.5' stroke='%23a1a1aa' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E";

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

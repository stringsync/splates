import type { Settings } from "./settings";

/**
 * Keeps `root` wearing the theme and accent `settings` hold: shadcn's theme
 * keys dark mode off a `dark` class, and styles.css keys each accent's palette
 * off `data-accent`. On System, the class follows `device`, including when it
 * switches at sunset with the page open. Returns what stops it.
 */
export function followAppearance(
	settings: Settings,
	root: HTMLElement,
	device: MediaQueryList,
): () => void {
	const apply = () => {
		const theme = settings.get("appearance.theme");
		root.classList.toggle(
			"dark",
			theme === "dark" || (theme === "system" && device.matches),
		);
		root.dataset.accent = settings.get("appearance.accent");
	};
	apply();
	device.addEventListener("change", apply);
	const unlisten = settings.events.on("changed", apply);
	return () => {
		device.removeEventListener("change", apply);
		unlisten();
	};
}

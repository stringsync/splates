import type { Settings } from "./settings";

/**
 * The page's background in each theme, `--background` in styles.css as hex,
 * which the browser paints its own bar in around an installed app.
 */
const THEME_COLORS = { light: "#f3f4f7", dark: "#1d1f23" } as const;

/**
 * Keeps `root` wearing the theme and accent `settings` hold: shadcn's theme
 * keys dark mode off a `dark` class, and styles.css keys each accent's palette
 * off `data-accent`. On System, the class follows `device`, including when it
 * switches at sunset with the page open. The `theme-color` meta under `root`,
 * when there is one, takes the theme's background. Returns what stops it.
 */
export function followAppearance(
	settings: Settings,
	root: HTMLElement,
	device: MediaQueryList,
): () => void {
	const apply = () => {
		const theme = settings.get("appearance.theme");
		const dark = theme === "dark" || (theme === "system" && device.matches);
		root.classList.toggle("dark", dark);
		root
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", THEME_COLORS[dark ? "dark" : "light"]);
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

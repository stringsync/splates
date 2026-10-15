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
 * when there is one, takes the theme's background, and so does the launch
 * image `draw` makes for an `apple-touch-startup-image` link. Returns what
 * stops it.
 */
export function followAppearance(
	settings: Settings,
	root: HTMLElement,
	device: MediaQueryList,
	draw: (background: string) => string | null = (background) =>
		launchImage(root.ownerDocument, background),
): () => void {
	let launched: string | null = null;
	const apply = () => {
		const theme = settings.get("appearance.theme");
		const dark = theme === "dark" || (theme === "system" && device.matches);
		const color = THEME_COLORS[dark ? "dark" : "light"];
		root.classList.toggle("dark", dark);
		root
			.querySelector('meta[name="theme-color"]')
			?.setAttribute("content", color);
		const launch = root.querySelector('link[rel="apple-touch-startup-image"]');
		if (launch !== null && launched !== color) {
			launched = color;
			const image = draw(color);
			if (image !== null) {
				launch.setAttribute("href", image);
			}
		}
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

/**
 * The 🌲 on `background`, the size of this screen, as a PNG data URL, or null
 * where there is no canvas to draw it on. iOS opens an installed app on a
 * white screen unless it has a launch image exactly the screen's size, and
 * never reads the manifest's colors. The tree is index.html's splash, at its
 * size, so the launch screen gives way to the page without a jump.
 */
function launchImage(document: Document, background: string): string | null {
	const view = document.defaultView;
	if (view === null) {
		return null;
	}
	const scale = view.devicePixelRatio;
	const canvas = document.createElement("canvas");
	canvas.width = view.screen.width * scale;
	canvas.height = view.screen.height * scale;
	const context = canvas.getContext("2d");
	if (context === null) {
		return null;
	}
	context.fillStyle = background;
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.font = `${96 * scale}px "Apple Color Emoji", sans-serif`;
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText("🌲", canvas.width / 2, canvas.height / 2);
	return canvas.toDataURL("image/png");
}

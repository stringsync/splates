import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { followAppearance } from "./appearance";
import { Settings } from "./settings";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("no #root to mount into: index.html and main.tsx disagree");
}

// Read before the first render, so the page never paints in the wrong theme.
const settings = new Settings(localStorage);
followAppearance(
	settings,
	document.documentElement,
	matchMedia("(prefers-color-scheme: dark)"),
);

// Every spinner runs on one clock: each spin starts at the document timeline's
// origin rather than when its element mounted, so all of them stand at the
// same angle at every frame, however many come and go.
document.addEventListener(
	"animationstart",
	(event) => {
		if (event.animationName !== "spin" || !(event.target instanceof Element)) {
			return;
		}
		for (const animation of event.target.getAnimations()) {
			if (
				animation instanceof CSSAnimation &&
				animation.animationName === "spin"
			) {
				animation.startTime = 0;
			}
		}
	},
	true,
);

// iOS Safari pinch-zooms whatever the viewport meta says, so the page cancels
// the pinch itself. gesturestart is WebKit's alone; elsewhere it never fires.
document.addEventListener("gesturestart", (event) => event.preventDefault());

// The worker a phone shows notifications through. A browser only allows one
// on https or localhost; elsewhere, notifications fall back to the page's own.
void navigator.serviceWorker?.register("/worker.js").catch(() => {});

createRoot(root).render(
	<StrictMode>
		<App settings={settings} />
	</StrictMode>,
);

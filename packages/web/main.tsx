import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserMicrophone, DictationSocket } from "webappwiz/dictate/browser";
import { scoped } from "./api";
import { followAppearance } from "./appearance";
import { Dictation } from "./dictation";
import { DictationContext } from "./dictation-context";
import { EVENTS_PREVIEW, EventsPreview } from "./events-preview";
import { EverywhereContext } from "./everywhere-context";
import { EverywhereFeed } from "./everywhere-feed";
import type { Stale } from "./page-cache";
import { ProjectApp } from "./project-app";
import { Settings } from "./settings";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("no #root to mount into: index.html and main.tsx disagree");
}

// The launch screen an installed app opens on, which only iOS reads, and only
// from a link: appearance.ts draws it in the theme's background.
if ("standalone" in navigator) {
	const launch = document.createElement("link");
	launch.rel = "apple-touch-startup-image";
	document.head.append(launch);
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
// It serves the page from its cache, and says when what it served was a build
// from before the server's last restart, which this script would not match.
navigator.serviceWorker?.addEventListener("message", (event) => {
	if ((event.data as Stale | undefined)?.type === "splates:reload") {
		location.reload();
	}
});

// The mic needs https or localhost, and a browser with an AudioWorklet to tap
// it; elsewhere the composer has no mic button.
const dictation =
	window.isSecureContext &&
	navigator.mediaDevices?.getUserMedia !== undefined &&
	typeof AudioWorkletNode !== "undefined"
		? new Dictation(new BrowserMicrophone(), (project) =>
				DictationSocket.open(
					`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${scoped("/api/dictation", project)}`,
				),
			)
		: null;

// Every project's tasks and conversations, held here, above the project
// shown, so switching projects leaves it streaming.
const everywhere = new EverywhereFeed();

createRoot(root).render(
	location.hash === EVENTS_PREVIEW ? (
		<StrictMode>
			<EventsPreview settings={settings} />
		</StrictMode>
	) : (
		<StrictMode>
			<DictationContext value={dictation}>
				<EverywhereContext value={everywhere}>
					<ProjectApp settings={settings} />
				</EverywhereContext>
			</DictationContext>
		</StrictMode>
	),
);

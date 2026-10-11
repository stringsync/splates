import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("no #root to mount into: index.html and main.tsx disagree");
}

// shadcn's theme keys dark mode off a class, so the class follows the device,
// including when it switches at sunset with the page open.
const dark = matchMedia("(prefers-color-scheme: dark)");
const theme = () =>
	document.documentElement.classList.toggle("dark", dark.matches);
theme();
dark.addEventListener("change", theme);

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

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

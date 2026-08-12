import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("no #root to mount into: index.html and main.tsx disagree");
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

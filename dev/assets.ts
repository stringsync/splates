import icon192 from "./build/icon-192.txt" with { type: "text" };
import icon512 from "./build/icon-512.txt" with { type: "text" };
import scriptMap from "./build/main.map.txt" with { type: "text" };
import script from "./build/main.txt" with { type: "text" };
import manifest from "./build/manifest.txt" with { type: "text" };
import shell from "./build/shell.txt" with { type: "text" };
import styles from "./build/styles.txt" with { type: "text" };
import workerMap from "./build/worker.map.txt" with { type: "text" };
import worker from "./build/worker.txt" with { type: "text" };

/** The files the browser asks for, as the server hands them over. */
export interface Assets {
	/** The page, which asks for the rest. */
	shell: string;
	/** The React app, bundled for the browser. */
	script: string;
	/** The React app's source map, which DevTools asks for while open. */
	scriptMap: string;
	/** The stylesheet, with Tailwind already compiled. */
	styles: string;
	/** The service worker, through which a phone shows notifications. */
	worker: string;
	/** The service worker's source map. */
	workerMap: string;
	/** The web app manifest, which makes the page installable as an app. */
	manifest: string;
	/** The app icon as PNG, at 192px and 512px square. */
	icons: { 192: Uint8Array<ArrayBuffer>; 512: Uint8Array<ArrayBuffer> };
}

/** The page this package ships. Serve each field's contents as-is. */
export const assets: Assets = {
	shell,
	script,
	scriptMap,
	styles,
	worker,
	workerMap,
	manifest,
	icons: {
		192: Uint8Array.fromBase64(icon192),
		512: Uint8Array.fromBase64(icon512),
	},
};

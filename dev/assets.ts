import icon192 from "./build/icon-192.txt" with { type: "text" };
import icon512 from "./build/icon-512.txt" with { type: "text" };
import script from "./build/main.txt" with { type: "text" };
import manifest from "./build/manifest.txt" with { type: "text" };
import shell from "./build/shell.txt" with { type: "text" };
import styles from "./build/styles.txt" with { type: "text" };

/** The files the browser asks for, as the server hands them over. */
export interface Assets {
	/** The page, which asks for the rest. */
	shell: string;
	/** The React app, bundled for the browser. */
	script: string;
	/** The stylesheet, with Tailwind already compiled. */
	styles: string;
	/** The web app manifest, which makes the page installable as an app. */
	manifest: string;
	/** The app icon as PNG, at 192px and 512px square. */
	icons: { 192: Uint8Array<ArrayBuffer>; 512: Uint8Array<ArrayBuffer> };
}

/** The page this package ships. Serve each field's contents as-is. */
export const assets: Assets = {
	shell,
	script,
	styles,
	manifest,
	icons: {
		192: Uint8Array.fromBase64(icon192),
		512: Uint8Array.fromBase64(icon512),
	},
};

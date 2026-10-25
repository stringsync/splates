import chunkNames from "../web-build/chunk-names.txt" with { type: "text" };
import icon192 from "../web-build/icon-192.txt" with { type: "text" };
import icon512 from "../web-build/icon-512.txt" with { type: "text" };
import scriptMap from "../web-build/main.map.txt" with { type: "text" };
import script from "../web-build/main.txt" with { type: "text" };
import manifest from "../web-build/manifest.txt" with { type: "text" };
import shell from "../web-build/shell.txt" with { type: "text" };
import styles from "../web-build/styles.txt" with { type: "text" };
import workerMap from "../web-build/worker.map.txt" with { type: "text" };
import worker from "../web-build/worker.txt" with { type: "text" };

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
	/**
	 * The chunks of the React app that load when a page first needs them, by
	 * the name the script asks for, each with its source map. They are most of
	 * the page's bytes, the maps most of theirs, so each loads only on its
	 * first ask: a process that serves no page never holds them.
	 */
	chunks: {
		names: readonly string[];
		code(): Promise<Record<string, string>>;
		maps(): Promise<Record<string, string>>;
	};
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
	chunks: {
		names: JSON.parse(chunkNames),
		// Imported as files, so a release carries them beside its bundle, and
		// read only on demand.
		code: once(async () => {
			const { chunkFiles } = await import("./chunk-files");
			return Bun.file(chunkFiles.code).json();
		}),
		maps: once(async () => {
			const { chunkFiles } = await import("./chunk-files");
			return Bun.file(chunkFiles.maps).json();
		}),
	},
	styles,
	worker,
	workerMap,
	manifest,
	icons: {
		192: Uint8Array.fromBase64(icon192),
		512: Uint8Array.fromBase64(icon512),
	},
};

/** `load`, run on the first call only, every call after given what it made. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
	let loaded: Promise<T> | null = null;
	return () => {
		loaded ??= load();
		return loaded;
	};
}

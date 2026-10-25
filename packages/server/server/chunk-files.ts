import maps from "../web-build/chunk-maps.txt" with { type: "file" };
import code from "../web-build/chunks.txt" with { type: "file" };

// A bundle inlines a text import into its source, so a bundled CLI would hold
// the chunks' megabytes from start-up. A file import copies the file beside
// the bundle instead, as a path from the bundle's root, which this module is
// at when imported on demand, as its own chunk; unbundled, the path is
// absolute and the URL takes it as it is.
export const chunkFiles = {
	code: new URL(code, import.meta.url),
	maps: new URL(maps, import.meta.url),
};

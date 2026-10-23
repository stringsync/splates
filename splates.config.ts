import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	// A fresh tree has no workspace links yet, so bootstrap before loading the CLI.
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev premerge",
	remote: null,
} satisfies ConfigFile;

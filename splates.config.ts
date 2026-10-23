import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev premerge",
	remote: null,
} satisfies ConfigFile;

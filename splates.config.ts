import type { ConfigFile } from "@stringsync/splates/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev test",
	wiz: "./bin/splates dev",
} satisfies ConfigFile;

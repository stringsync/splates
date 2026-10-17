import type { ConfigFile } from "./packages/splates/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev test",
	wiz: "./bin/splates dev",
} satisfies ConfigFile;

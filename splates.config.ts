import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	remote: null,
} satisfies ConfigFile;

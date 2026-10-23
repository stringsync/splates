import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "./bin/splates dev postcheckout",
	postRewrite: "./bin/splates dev postrewrite",
	preMerge: "./bin/splates dev premerge",
	remote: null,
} satisfies ConfigFile;

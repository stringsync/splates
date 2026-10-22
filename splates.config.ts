import { AwsCloud } from "@stringsync/splates-server/cloud";
import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	cloud: new AwsCloud(),
} satisfies ConfigFile;

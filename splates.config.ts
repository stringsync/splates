import { DigitalOceanCloud } from "@stringsync/splates-server/cloud";
import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev test",
	// What a runner does to a fresh checkout before a heavy job, as
	// `docker/worker.Dockerfile` does: the install's scripts build the page, which
	// needs the source, so they are skipped and the build run after.
	prepare:
		"bun install --frozen-lockfile --ignore-scripts && bun run --cwd packages/web build",
	remote: null,
	// Runners for heavy jobs, made with the device cred DIGITALOCEAN_TOKEN.
	cloud: new DigitalOceanCloud(),
} satisfies ConfigFile;

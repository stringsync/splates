import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	// What a runner does to a fresh checkout before a heavy job, as
	// `docker/test.Dockerfile` does: the install's scripts build the page, which
	// needs the source, so they are skipped and the build run after.
	prepare:
		"bun install --frozen-lockfile --ignore-scripts && bun run --cwd packages/web build",
	remote: "origin",
} satisfies ConfigFile;

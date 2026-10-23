import { FlyCloud } from "@stringsync/splates-server/cloud";
import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	// No merge gate for now: the runner setup kept every merge from landing.
	// It comes back running here, one at a time (the "Local premerge" lane).
	// What a runner does to a fresh checkout before a heavy job, as
	// `docker/worker.Dockerfile` does: the install's scripts build the page, which
	// needs the source, so they are skipped and the build run after.
	prepare:
		"export PATH=$HOME/.bun/bin:$PATH; " +
		"command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2; " +
		"bun install --frozen-lockfile --ignore-scripts && bun run --cwd packages/web build",
	remote: null,
	// Runners for heavy jobs, made on Fly.io with the device cred FLY_API_TOKEN.
	cloud: new FlyCloud(),
} satisfies ConfigFile;

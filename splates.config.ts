import type { ConfigFile } from "@stringsync/splates-server/config";

export default {
	postCheckout: "bun install",
	postRewrite: "bun install",
	preMerge: "./bin/splates dev premerge",
	// What a runner does to a fresh checkout before a heavy job, as
	// `docker/worker.Dockerfile` does: the install's scripts build the page, which
	// needs the source, so they are skipped and the build run after.
	prepare:
		"export PATH=$HOME/.bun/bin:$PATH; " +
		"command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash -s bun-v1.4.2; " +
		"bun install --frozen-lockfile --ignore-scripts && bun run --cwd packages/web build",
	remote: null,
} satisfies ConfigFile;

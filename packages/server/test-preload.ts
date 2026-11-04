// Test-only: the server's tests import `web-build`, which the page's build
// writes and git ignores. Builds it when it is missing, so a fresh checkout
// needs no install hook.
import { existsSync } from "node:fs";

if (!existsSync(`${import.meta.dirname}/web-build/main.txt`)) {
	const built = Bun.spawnSync(
		["bun", `${import.meta.dirname}/../web/build.ts`],
		{
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (built.exitCode !== 0) {
		throw new Error("the page failed to build");
	}
}

import type { MirrorOptions } from "core/ship";

/** Where and how splates is mirrored to its public repository. */
export const MIRROR = {
	project: "splates",
	remote: "https://github.com/stringsync/splates.git",
	// The standalone repository's last commit, which the first mirror takes over from.
	adopt: "5d3c7b81aa3998a83eb406ee6728b2619dddb95c",
	// `splates init` installs the skill from the release's tag here.
	tag: true,
	// vet and scry never leave mono, nor do the rules and skills for them
	config: {
		exclude: [
			"**/.vet/**",
			"**/vet.config.ts",
			"**/.scry/**",
			"**/scry.config.ts",
			"**/.claude/**",
			"**/.agents/**",
		],
		// The skill is the product: `splates init` installs it from this repository.
		keep: ["skills/splates/**"],
		// The server's tests import the page this builds, as mono's root does.
		scripts: { postinstall: "bun run --cwd packages/web build" },
	},
} satisfies MirrorOptions;

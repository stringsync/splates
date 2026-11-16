// splates's ship target: @stringsync/splates goes to npm through its public
// mirror, stringsync/splates, whose publish workflow npm trusts. The server,
// the evals harness and rec are private, so the build folds them in.
// `bin/splates dev ship` serves it.

import { npm, target } from "core/ship";

export const splatesShip = target({
	name: "@stringsync/splates",
	bump: "patch",
	dependencies: [],
	plan: ({ bump = "patch" }) =>
		npm.release({
			package: "@stringsync/splates",
			bump,
			repository: "stringsync/splates",
			// The build compiles without checking types, so the root checks are
			// its gate; whoever ships is expected to have run the suite.
			test: "bin/mono fix --check --code-only",
			// `splates init` installs the skill from the release's tag.
			keep: ["skills/splates/**"],
			fold: {
				"@evals/evals": {},
				// What rec reads from beside its code when it runs: its extension,
				// its skill, and the control page `prepare` builds ahead.
				"@mono/rec": {
					files: [
						"extension/**",
						"skill/**",
						"control/index.html",
						"control/built/control.js",
						"control/built/control.css",
					],
				},
			},
			// The server imports the page's build, which git does not keep; rec
			// cannot build its control page from a bundle; and the skill says
			// which release it came from.
			prepare:
				"bun run --cwd packages/web build && bun packages/rec/control/build.ts --out packages/rec/control/built && bun packages/splates/dev/stamp-skill.ts",
			// What npm would get, installed and run as a user would.
			check: "bun packages/splates/dev/check-build.ts",
		}),
});

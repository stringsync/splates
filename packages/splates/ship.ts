// splates's ship target: @stringsync/splates goes to npm through its public
// mirror, stringsync/splates, whose publish workflow npm trusts. The server,
// the evals harness and rec are private, so the build folds them in.
// `bin/splates dev ship` serves it.

import { commitsSince, npm, target } from "core/ship";

// What a release carries: the package, the server and the page it serves, the
// skill it keeps, and what the build folds or bundles in (evals, rec, core).
const SHIPPED_PATHS = [
	"splates/packages/splates",
	"splates/packages/server",
	"splates/packages/web",
	"splates/skills/splates",
	"evals/packages/evals",
	"rec/packages/rec",
	"core/packages/core",
];

export const splatesShip = target({
	name: "@stringsync/splates",
	bump: "patch",
	dependencies: [],
	// `npm.release` tags the mono commit it built from as
	// `@stringsync/splates@<version>`; the newest such tag marks the last ship.
	unshipped: (ctx) =>
		commitsSince(ctx, {
			release: "@stringsync/splates",
			paths: SHIPPED_PATHS,
		}),
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
			// The composed mirror's own tests, before it is committed. Each
			// package runs on its own, as `bin/mono test` runs them: one `bun test`
			// over the root mixes the page's happy-dom globals and the default 5 s
			// timeout into the server's tests, which then fail and hang.
			mirrorTest:
				'for dir in packages/* skills/splates/evals; do [ -d "$dir" ] || continue; (cd "$dir" && bun test --pass-with-no-tests --timeout 120000) || exit 1; done',
		}),
});

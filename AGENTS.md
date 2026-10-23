Use the splates skill for any work that may change code: start a task with
`splates add` before investigating, and land it with `splates merge`.

In your worktree, run `bin/splates`, never the `splates` on your PATH or
`bunx @stringsync/splates`: those are other builds, while `bin/splates` runs the
code you are editing. Every `splates ...` command in this file means
`bin/splates ...` for you.

When the user says "the server", they mean the splates server, `splates server`:
it serves the splates web app and coordinates agents and their workers. Code
may still call it the coordinator, as in `CoordinatorIdentity` or `--coordinator`,
where that sets it apart from a worker; it is the same thing.

After making code changes, `splates dev fix` typechecks, formats and checks
the project, scry included. Do not run the test suite yourself: the merge
gate runs it, as `bin/splates dev premerge` (`preMerge` in
`splates.config.ts`), here on this machine, one gate at a time, so a run of
your own is the same work twice. Running a test file or two you changed by
hand (`bun test <path>`) is fine, as is any scoped `splates dev test`
(`--changed`, `--since main`, file paths, `--test-name-pattern`, `--evals`),
which needs no approval. An unscoped `splates dev test` or `splates dev
premerge` is refused an agent until the person approves one run from a
`## 🔐 Permission: run the test suite: <why>` card. `splates dev test --evals` tests the eval
harness, for changes under `evals/`.

`splates dev` holds only this repository's own commands. Run webappwiz's,
which its skills call `wiz` (`wiz scry`, `wiz skills`), as
`bunx @webappwiz/cli <command>`.

During a splates task, the user may be on the splates server from another device, so give every link as both its remote and its local URL.

If you change the CLI's API, check that the agent skill at
`skills/splates/SKILL.md` is still in sync. That is the source; this repo's
`.agents/skills/splates` links to it, and other projects install it from a
release tag with `bunx skills add`.

`splates` runs whichever checkout you are standing in, so working on it from a
worktree merges with the code you are editing. Pin the main tree for the
merge itself: `SPLATES_ROOT="$(splates path)" splates merge`.

## Module directories

`packages/server/` is moving from flat files into one directory per module, as webappwiz lays out its packages.
`packages/server/conversations/` is the one to copy:

- Files drop the directory's prefix: `conversation-state.ts` became
  `conversations/state.ts`, its test `conversations/state.test.ts`; the
  module named for the directory keeps its name (`conversations.ts` became
  `conversations/conversations.ts`). Fakes and fixtures for other modules'
  tests go in `testing.ts` (`conversation-testing.ts`).
- `index.ts` is the directory's surface and holds nothing but re-exports, by
  name (`export { nameOf } from "./name"`, no `export *`), of everything used
  from outside the directory. Outside it, import `./conversations` or, in a
  test, `./conversations/testing`, never a file inside it. Inside it, import
  a sibling directly (`./state`), never `./index`, and the rest of the
  package as `../x`. A test inside it may import `./index`, the surface it
  tests.
- The page bundles for the browser, and an index that brings in agent
  processes or `bun:` modules breaks that build. When the page needs values
  from such a directory, put those in `browser.ts`, re-exported from
  browser-safe files only, and have the page import its values from
  `@stringsync/splates-server/<dir>/browser`; `import type` from the index
  is erased and stays fine. Check with a browser `Bun.build` of `packages/web/main.tsx`.
- In `packages/server/package.json`, one `exports` entry per directory,
  `"./<dir>": "./<dir>/index.ts"`, replacing the entries of the files it took
  in, plus `"./<dir>/browser"` or `"./<dir>/testing"` only when another
  package imports it. Releases bundle each entry, so no `"./*"` wildcard.
- A move rebases every open task that edits the files it takes in, so check
  `splates list --files` and land between those tasks.

Only run `splates dev eval` when the user asks you to, since it uses tokens the
user pays for: billed to an API key, or counted against their Claude plan's
usage limits (see `evals/splates-skill/README.md`).
`splates dev eval report` and the evals' tests (`splates dev test --evals`)
are free.

This is the public mirror of splates, which is developed in a larger private repository and pushed
here on each release. Change it here only for a fix you mean to send back as a pull request.

When the user says "the server", they mean the splates server, `splates server`:
it serves the splates web app and coordinates agents and their workers. Code
may still call it the coordinator, as in `CoordinatorIdentity` or `--coordinator`,
where that sets it apart from a worker; it is the same thing.

After making code changes, run `bun test <path>` for the test files you changed or that reach
your change, and `bunx tsc --noEmit -p <package>` and `bunx biome check` for the package you
touched. Packages live in `packages/`; each runs its tests on its own, so test the package, not
the whole repository.

`bun install` at the root builds the page into `packages/server/web-build`,
which the server's tests import.

Everything runs on the person's machine, beside their work and every other
agent's, and nothing caps how many agents they run, so keep runs small.
Before anything heavy, meaning a lot of CPU or memory (a full build, a whole
suite, docker, a benchmark, anything that keeps cores busy for more than a
minute), read `splates machine`. Not busy: run it. Busy: ask with the run-command
permission card the splates skill shows, saying the machine is busy, end your
turn, and run only on `[SPLATES RUN ALLOWED]`. An install, a typecheck or a lint
is not heavy: run it. This is best effort: nothing enforces it.

During a splates task, the user may be on the splates server from another device, so give every link as both its remote and its local URL.

If you change the CLI's API, check that the agent skill at
`skills/splates/SKILL.md` is still in sync. That is the source; the root
`.agents/skills/splates` and `.claude/skills/splates` link to it, and other projects install it from a
release tag with `bunx skills add`.

## Module directories

`packages/server/` is moving from flat files into one directory per module, as the other projects lay out theirs.
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
  `@splates/server/<dir>/browser`; `import type` from the index
  is erased and stays fine. Check with a browser `Bun.build` of `packages/web/main.tsx`.
- In `packages/server/package.json`, one `exports` entry per directory,
  `"./<dir>": "./<dir>/index.ts"`, replacing the entries of the files it took
  in, plus `"./<dir>/browser"` or `"./<dir>/testing"` only when another
  package imports it. Releases bundle each entry, so no `"./*"` wildcard.
- A move rebases every open task that edits the files it takes in, so check
  `splates list --files` and land between those tasks.

Only run `splates dev eval` when the user asks you to, since it uses tokens the
user pays for: billed to an API key, or counted against their Claude plan's
usage limits.
`splates dev eval report`, `splates dev eval show` and the evals' tests (`bun test` in `packages/evals`)
are free.

Assume any user may clone and run this public repository against their own
accounts. Personal hosts, ids and email addresses belong in local state, never
tracked files. Never commit secrets, including encrypted secrets; read them from
the creds store at runtime.

Billing costs come from pulled sources, never hand entry. An unreachable provider
must not be recorded as zero.

`designs/` holds decisions settled with the user, rather than live documentation.
Read their dates: later decisions may supersede earlier settled paragraphs.

**Deliver screenshots before asking for visual review.** A tool preview is
visible to you, not automatically to the user. Run `bin/splates attach <file>`,
then copy the image Markdown it prints into your reply, outside a code block.
Use the stored path it returns, not the original capture path. For task
evidence, put the same image under `## Verification` in `SPLATES.md`.
A filename, plain link or “see screenshot” does not deliver an image. If
attachment fails, report the failure rather than claiming the user can see it.

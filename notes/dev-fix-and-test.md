---
description: How splates dev test selects changed tests, file paths and test names for focused one-worker development checks, the approval an agent needs for the whole suite, the six-minute deadline, DOM separation, and dev fix
---

`splates dev fix` runs, stopping at the first failure: `biome check --write
--unsafe .` (no write under `--check`), `tsc --noEmit`, then `wiz scry check
--since main --disable-over-budget`, so scry reads only what changed since
`main` and a spent model budget narrows the check rather than failing it.
`--code-only` disables scry's `som` and `llm` models so no cred is read.
`ship` gates on `fix --check` with scry skipped.

For development, prefer `splates dev test --changed`: Bun uses the dirty
worktree and its import graph to select affected tests (staged, unstaged and
untracked changes). After committing use `--since main` to compare against a
branch or commit. Positional file paths narrow the files further;
`--test-name-pattern <regex>` narrows cases. These selectors combine. Use
`--evals` for free eval harness tests or `--all` to include both packages and
evals. A focused run stays here and
uses one worker by default; `--workers <n>` sets a positive worker limit.
Leave the whole suite to the merge gate. No `--local` flag exists.

The person runs as many agents as they like on one machine and nothing caps
them, so AGENTS.md and the splates skill teach agents to keep runs narrow: run
`dev fix` once per step (`--code-only` to skip scry's model calls), and ask
with the run-command permission card for anything else heavy (a build, an
install, docker, a benchmark), running it only on `[SPLATES RUN ALLOWED]`.

An agent (`SPLATES_CONVERSATION` set) is refused an unscoped `dev test`
or `dev premerge` with `not_granted`, its message naming the scoped flags,
which need no approval (`--evals` counts as scoped). Outside a gate
(`SPLATES_PREMERGE`) it runs only once the person approves a `## 🔐
Permission: run the test suite: <why>` card: its Approve button posts
`/api/conversations/:id/suite`, which writes a one-run grant to
`~/.splates/suite-grants/<conversation>` (`SuiteGrants`, standing an
hour) and tells the agent to run it; `splates dev approve-suite
<conversation>` writes the same grant from a terminal. The run takes the
grant (`refuseWholeSuite` in `packages/splates/dev/test.ts`), so each
approval is one run. The person's own runs, from no conversation, are
never asked. The grant is on this machine, where every agent runs.

An unfiltered `splates dev test` runs `bun test --parallel=<half the cores> --timeout
30000` (all but two cores in a merge's gate): a worker per core
starved the git-spawning suites, and 16 workers failed 20 to 30 tests a run
where 8 failed 0 to 2. The whole run is killed at six minutes, after one
test spinning in a synchronous loop held the machine for ten hours; inside
`dev premerge`, at what is left of the gate's 3 minutes. `evals/**` is excluded unless `--evals` (only
evals) or `--all`. Under the merge gate `SPLATES_TEST_REPORT` adds a JUnit
reporter, which is how a failure is blamed and a failing test becomes a task.
The repo sets `preMerge: "./bin/splates dev premerge"`: `dev fix --check`'s checks, then `dev test --ci`, here, so a merge runs the suite on the rebased code. Trailing arguments
filter the test files by path, as `bun test` does.

It runs as two `bun test` runs, one after the other: the page's
(`packages/web`) and the rest, since happy-dom replaces `setTimeout`, `URL`
and other globals the server is tested against. Each runs `--no-isolate`, a
worker keeping one module registry across its files: per-file isolation
reloaded the DOM, React and the page for each of 200 page files, a quarter
of the suite's CPU. The page's run preloads `packages/web/test-preload.ts`,
which cleans up after every test, so a page test must not lean on module
state an earlier file set (`knowFocused` in `markdown.test.tsx`). The two
JUnit reports are joined into `SPLATES_TEST_REPORT`. On macOS it puts
Xcode's git ahead of `/usr/bin/git`, an `xcrun` stub that cost the server
tests a third of their CPU. Measured 2026-10-22 on a 4-CPU Linux container:
118s → 67s wall, 252s → 140s CPU.

`splates dev test` always runs here, never on a runner (2026-10-23); this
repo's `splates.config.ts` names no cloud. The `--linux` selector went with
remote runners; no Linux image or runner proof remains.

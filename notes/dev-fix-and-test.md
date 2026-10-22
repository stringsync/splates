---
description: What splates dev fix and splates dev test run, why the test run is capped at half the cores with a six-minute deadline, and why the page's tests run apart without isolation
---

`splates dev fix` runs, stopping at the first failure: `biome check --write
--unsafe .` (no write under `--check`), `tsc --noEmit`, then `wiz scry check
--since main --disable-over-budget`, so scry reads only what changed since
`main` and a spent model budget narrows the check rather than failing it.
`--code-only` disables scry's `som` and `llm` models so no cred is read.
`ship` gates on `fix --check` with scry skipped.

`splates dev test` runs `bun test --parallel=<half the cores> --timeout
30000`, waiting up to five minutes to claim those cores: a worker per core
starved the git-spawning suites, and 16 workers failed 20 to 30 tests a run
where 8 failed 0 to 2. The whole run is killed at six minutes, after one
test spinning in a synchronous loop held a heavy slot for ten hours. It
takes a heavy-job slot itself. `evals/**` is excluded unless `--evals` (only
evals) or `--all`. Under the merge gate `SPLATES_TEST_REPORT` adds a JUnit
reporter, which is how a failure is blamed and a failing test becomes a task.
The repo sets `preMerge: "./bin/splates dev test"` (dropped in ab003c58 while tests were too heavy, restored once the gate ran on runners), so a merge runs the suite on the rebased code. Trailing arguments
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

`splates dev test` runs on a runner when one has joined the server and it is
not already inside a heavy slot (`SPLATES_HEAVY`, `SPLATES_CORES`): see
`heavy-jobs-on-runners.md`. The job's command is `./bin/splates dev test
--local` with the same filters, run in the runner's checkout of a snapshot of
the worktree, and its JUnit report comes back as a returned file to where
`SPLATES_TEST_REPORT` names. `--local` runs it here as above. `--linux` went
with this: every runner is Linux. Before it, on 2026-10-21, the suite's first
Linux run passed every test (3443, 554 files, 34s) on aarch64; as `linux/amd64`
under Rosetta three tests failed, the ones that expect "cannot start <argv>"
on a missing executable, which the emulation exits 127 without raising.

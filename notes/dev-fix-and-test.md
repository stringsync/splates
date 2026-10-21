---
description: What splates dev fix and splates dev test run, and why the test run is capped at half the cores with a six-minute deadline
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
The repo's `preMerge` is `./bin/splates dev test`. Trailing arguments
filter the test files by path, as `bun test` does.

`splates dev test --linux` builds `docker/test.Dockerfile` from the checkout
(the worker image's packages without Chromium, user `splates`, the page
built inside) and runs the same `bun test` in it with `--init`, since the
coordinator's box and the workers are Linux and the suite had only ever run
on macOS. Its first run, 2026-10-21, passed every test (3443, 554 files,
34s) on aarch64 Linux; as `linux/amd64` under Rosetta three tests failed,
all the ones that expect "cannot start <argv>" on a missing executable,
which the emulation exits 127 without raising, so that is to be read on a
real x86 box, not here. The image is the host's architecture; Docker must
be running.

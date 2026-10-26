---
description: How splates dev fix and dev test run, how the runs are scheduled as jobs, and the suite's timeouts and DOM split; read before running or changing either
---

`splates dev fix` typechecks, formats and scry-checks; `splates dev test`
runs the suite, but an agent runs only a scoped part of it. The whole suite
runs in the merge gate; elsewhere it is a low, requeue-able job.

## dev fix

- It stops at the first failure and runs `biome check --write --unsafe .` (no
  write under `--check`), `tsc --noEmit`, then `wiz scry check --since main
  --disable-over-budget`.
- Scry reads only what changed since `main`, and a spent model budget narrows
  the check rather than failing it.
- `--code-only` disables scry's `som` and `llm` models so no cred is read.
- `ship` gates on `fix --check` with scry skipped.

## Scoped dev test

- `--changed` uses the dirty worktree and Bun's import graph to select
  affected tests (staged, unstaged and untracked).
- `--since main` compares against a branch or commit, for after committing.
- Positional file paths narrow the files; `--test-name-pattern <regex>`
  narrows cases. These selectors combine.
- `--evals` runs the free eval harness tests; `--all` includes packages and
  evals.
- A focused run stays here on one worker; `--workers <n>` sets a positive
  limit. No `--local` flag exists.

## Keeping runs small

The person runs as many agents as they like on one machine, and nothing caps
them. AGENTS.md and the splates skill teach agents to run `dev fix` once per
step (`--code-only` to skip scry's model calls) and to run anything else
that needs the machine as `splates run -- <cmd>`, a job that waits its turn;
the run-command permission card is for a cost that is not compute.

## Jobs

- Every `dev test` and `dev fix` run submits a job to the server's scheduler
  (`packages/splates/dev/job.ts`, `scheduled`, over `JobClient`) and runs on
  its grant; nobody approves a run by hand.
- A scoped run asks for `cpus` = its workers (one by default), at low
  priority. An unscoped run asks for the `suite` pool and the gate's range of
  cpus (`gateJob`), at low priority and requeue-able: a merge's gate
  preempts it, and it waits and starts over. `--evals` asks for cpus only.
  `dev fix` asks for 2 cpus at low priority.
- No server (no `SPLATES_DEV`, or one that does not answer), a merge's gate
  (`SPLATES_PREMERGE`) and `dev premerge`, which holds the machine itself,
  run at once, unscheduled.
- Scopes (`--changed`, `--since`, paths, `--test-name-pattern`) only choose
  files; none is refused or needs a card.

## The whole run

- An unfiltered run is `bun test --parallel=<half the cores> --timeout 30000`;
  in a merge's gate, `--parallel=$SPLATES_CORES`, the cores the load left
  idle (`gateCores`, `jobs.md`). Trailing arguments filter files by path, as `bun
  test` does.
- The whole run is killed at six minutes; inside `dev premerge`, at what is
  left of the gate's 3 minutes.
- `evals/**` is excluded unless `--evals` or `--all`.
- Under the merge gate `SPLATES_TEST_REPORT` adds a JUnit reporter, which is
  how a failure is blamed and a failing test becomes a task.
- The repo sets `preMerge: "./bin/splates dev premerge"`: `dev fix --check`'s
  checks, then `dev test --ci`, here, on the rebased code.
- It always runs here, never on a runner (2026-10-23); `splates.config.ts`
  names no cloud, and the `--linux` selector went with remote runners.

## Making way for the gate

- A `dev test` or `dev fix` run from a conversation lowers its own priority
  to nice 10 (`AgentPriority`): a courtesy beside the scheduler, which is the
  mechanism.
- A gate's own run, a `dev premerge` by hand and the person's runs keep
  theirs (`jobs.md`).

## DOM split

- It runs as two `bun test` runs in turn: the page's (`packages/web`) and the
  rest, since happy-dom replaces `setTimeout`, `URL` and other globals the
  server is tested against.
- Each runs `--no-isolate`, a worker keeping one module registry across its
  files.
- The page's run preloads `packages/web/test-preload.ts`, which cleans up
  after every test, so a page test must not lean on module state an earlier
  file set (`knowFocused` in `markdown.test.tsx`).
- The two JUnit reports are joined into `SPLATES_TEST_REPORT`.
- On macOS it puts Xcode's git ahead of `/usr/bin/git`, an `xcrun` stub.

## Measured

- Worker count: a worker per core starved the git-spawning suites, and 16
  workers failed 20 to 30 tests a run where 8 failed 0 to 2.
- Six-minute kill: one test spinning in a synchronous loop held the machine
  for ten hours.
- `--no-isolate`: per-file isolation reloaded the DOM, React and the page for
  each of 200 page files, a quarter of the suite's CPU.
- Xcode's git: the `xcrun` stub cost the server tests a third of their CPU.
- Together, on a 4-CPU Linux container, 2026-10-22: 118s → 67s wall, 252s →
  140s CPU.
- Lazy page chunks, 2026-10-25: a test file importing `testing` no longer
  loads the page's 15 MB of chunks and maps, about 250 MB less per worker;
  `packages/splates/e2e.test.ts` peaks at 0.89 GB of tree RSS, from 1.29 GB.
- Page worker memory, 2026-10-25 (16 cores, bun 1.4.2, one worker over all
  225 page files, 334s): RSS 500 MB → 1.6 GB, but physical footprint
  (`footprint -p`) 233 → 432 MB, peaking there; over 40 files, RSS 207 →
  886 MB against a footprint of 198 → 303 MB. `vmmap` showed mimalloc's
  region (tag 240) 1.4 GB resident and 364 MB dirty: on macOS the pages it
  frees stay counted in RSS until memory pressure, so RSS read three times
  the footprint. `dev test`'s peak is the footprint on macOS for that reason.
  A gate worker's share, 28 files, costs about 260 MB; the footprint grows
  with the files a worker has loaded, since `--no-isolate` keeps every
  file's modules, steeper over the alphabetically late files. 40 trivial
  `render(<p>)` files cost 0.3 MB each. `--smol` changed nothing (305 MB
  over 40 files). Before this, every page request's `AbortSignal.timeout`
  left a 30s timer running after its answer, 1,500 of them pending in a
  worker, each holding its request's page; `expiring` in
  `packages/web/api/request.ts` disposes the timer with the answer, which cut
  the full run's peak footprint from 573 to 432 MB and the pending timers to
  under ten.

## Where

- `packages/splates/dev/job.ts`: `scheduled`
- `packages/splates/dev/priority.ts`: `AgentPriority`
- `packages/splates/dev/peak-memory.ts`: `PeakMemory`, `footprintKb`
- `packages/web/test-preload.ts`
- `splates.config.ts`: `preMerge`

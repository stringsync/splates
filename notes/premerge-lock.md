---
description: How merge gates take turns on this machine and how long a gate may run; bears on slow or stuck merges and on what waits for what
---

The whole suite is the only heavy thing splates runs, and it runs only as
a premerge. Every merge's gate, and a `splates dev premerge` run by hand,
holds the machine's premerge lock, so one premerge runs at a time.
Nothing else waits on it.

## How it works

- The premerge lock is `~/.splates/premerge.lock`,
  `premergeLockOfMachine`.
- Landing itself holds the project's merge lease, `merge.lock`.
- Nothing else waits on either: installs, hooks, focused
  `splates dev test` runs and `splates run` take no lock.

## Time limits

A gate runs at most `PREMERGE_TIMEOUT_MS`, 3 minutes. Past it the gate's
shell is killed and `splates merge` refuses with `timeout`. The refusal
spends no attempt, so the agent merges again.

`dev premerge` stops its own test run at the same point, since killing
the gate's `sh` leaves its children running.

A holder keeps the lock at most `PREMERGE_HOLD_MS`, also 3 minutes
(`TimedLock`), so a hung holder cannot wedge every merge.

## What the gate sets

- `SPLATES_PREMERGE`, so the `dev premerge` it runs goes ahead without
  waiting on the lock the gate holds.
- `SPLATES_CORES`, all but two cores, which `dev test` runs that many
  workers on.
- `Testing` strips both.

## Recent failures first

Inside a gate, `dev premerge` first runs the test files that failed
recent gates, quietly and with `--bail`. They are the `failedTests` of
`merge` log entries from the last 3 hours (`recentFailedFiles`), passed
in `SPLATES_RECENT_FAILED_FILES`, those still in the tree.

If they fail again the gate stops there with that report, which
attribution retests as usual. If they pass, the full suite runs as
before, so no test is skipped.

## History

Until 2026-10-23, heavy-job slots (`HeavyJobs`, `SPLATES_HEAVY_JOBS`) and
a core budget (`SPLATES_HEAVY_CORES`) made hooks, test runs and installs
queue behind each other. The premerge lock already ran the suite one at a
time, so they only made short work wait behind it, and were removed.

## Where

- `packages/server/server/premerge.ts`: `premergeLockOfMachine`,
  `PREMERGE_TIMEOUT_MS`, `PREMERGE_HOLD_MS`, `TimedLock`
- `packages/server/merge/gate.ts`: `SPLATES_CORES`
- `packages/server/merge/merge.ts`: the `timeout` refusal
- `packages/server/merge/recent-failures.ts`: `recentFailedFiles`
- `packages/splates/dev/premerge.ts`
- `packages/server/testing.ts`: `Testing`

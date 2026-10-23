---
description: How merge gates take turns on the machine (the premerge lock), the 3-minute kill on a gate, and what replaced the heavy-job slots and core budget
---

The whole suite is the only heavy thing splates runs, and it runs only as a
premerge. Every merge's gate, and a `splates dev premerge` run by hand,
holds the machine's premerge lock (`~/.splates/premerge.lock`,
`premergeLockOfMachine` in `packages/server/server/premerge.ts`), so one
premerge runs on the machine at a time. Landing itself holds the project's
merge lease (`merge.lock`). Nothing else waits on either: installs, hooks,
focused `splates dev test` runs and `splates run` take no lock.

A gate runs at most `PREMERGE_TIMEOUT_MS`, 3 minutes: past it the gate's
shell is killed and `splates merge` refuses with `timeout`, spending no
attempt, for the agent to merge again. `dev premerge` stops its own test
run at the same point, since killing the gate's `sh` leaves its children
running. A holder keeps the lock at most `PREMERGE_HOLD_MS`, also 3 minutes
(`TimedLock`), so a hung holder cannot wedge every merge.

The gate sets `SPLATES_PREMERGE`, so the `dev premerge` it runs goes ahead
without waiting on the lock it holds, and `SPLATES_CORES` to all but two
cores, which `dev test` runs that many workers on. `Testing` strips both.

Until 2026-10-23, heavy-job slots (`HeavyJobs`, `SPLATES_HEAVY_JOBS`) and a
core budget (`SPLATES_HEAVY_CORES`) made hooks, test runs and installs queue
behind each other. The premerge lock already ran the suite one at a time,
so they only made short work wait behind it, and were removed.

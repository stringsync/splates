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
- Nothing else waits on either: installs, hooks and focused
  `splates dev test` runs take no lock.

## Time limits

Waiters take the lock first come, first served: `TicketedLock`
(`packages/server/server/ticketed-lock.ts`) wraps the `FileLock`, each waiter
leaving a ticket in `~/.splates/premerge.queue/` and only the oldest live
ticket asking the lock itself, which otherwise goes to whichever waiter polls
first. A ticket whose process is gone is dropped by the next waiter to look.
The lock tells each waiter its place as it changes; `MergeGate.reserve`
passes it to `splates merge`, which keeps it on the task's record as
`mergePlace` while the merge is queued, so the inbox row says "Waiting to
merge · next" or "· 2nd in line" and the sidebar the same word beside the
icon.

A gate runs at most `PREMERGE_TIMEOUT_MS`, 3 minutes. Past it the gate's
shell is killed and `splates merge` refuses with `timeout`. The refusal
spends no attempt, so the agent merges again.

`dev premerge` stops its own test run at the same point, since killing
the gate's `sh` leaves its children running.

A holder keeps the lock at most `PREMERGE_HOLD_MS`, also 3 minutes
(`TimedLock`), so a hung holder cannot wedge every merge; each gate run
renews the hold (`PlacedLock.renew`), since each is bounded on its own and
a batch's rounds and retests add up past one hold.

Merges waiting at once gate as one batch under the holder's lock, so the
line is usually shorter than the merges asking. The merge status popover
groups confirmed running members under “Testing together”, leaving tasks
still waiting below; invitations without a successfully stacked branch do
not count as membership. A batch stays visible even with nobody waiting
outside it. The page reads coordination records and follows dissolved and
reformed groups. See `merge-pipeline.md`,
Batches. A waiter that a batch lands gives its wait up through the
`AbortSignal` `TicketedLock.acquire` takes, leaving no ticket.

## What the gate sets

- `SPLATES_PREMERGE`, so the `dev premerge` it runs goes ahead without
  waiting on the lock the gate holds.
- `SPLATES_CORES`, the test workers its `dev test` runs: the cores the last
  minute's load left idle, between half the cores and all but two
  (`gateCores`, `merge/cores.ts`). That load leaves out what the gate
  before still adds to it, cpus × (1 − e^(−ran/60s)) × e^(−since/60s), as
  the one-minute average keeps a gate's workers for about a minute after it
  ends (`GateTrail`, `lingering`; each run kept in `gate.last` in the
  machine's splates home). Counted as the person's, it held back-to-back
  gates to 8 workers (web tests 42.6s, against 30.3s at 11 to 12;
  2026-10-26). Elsewhere `dev test` runs half the cores.
  Either way `dev test` lowers each half's count to what half of free memory
  holds at the half's measured worker cost (`dev/worker-memory.ts`; an
  agent's run takes a quarter), never below 1.
- `Testing` strips both.

14 workers with the load at 32 took 148 to 170s and timed out, 8 took 63 to
78s and none did; on a quiet machine 8 took 58.8s, 11 50.6s and 14 48.5s
(2026-10-23), hence a share sized by the load.

## The gate keeps the CPU

The gate runs inside the agent's own `splates merge`, so it cannot raise its
priority; what splates runs beside it lowers its own instead, to
`BESIDE_GATE_NICE` (10, `server/premerge.ts`): a `dev test` or `dev fix`
run from a conversation (`AgentPriority` in `packages/splates/dev/priority.ts`,
which a gate's own run and a `dev premerge` by hand skip) and the postCheckout
hook's install (`Shell`'s `nice` option). Measured here with the cores
oversubscribed, nice 10 gets about half the share of nice 0, and nice 19
hardly less, where on Linux it would all but stop the run. The person's
own runs are never niced.

## Recent failures first

Inside a gate, `dev premerge` first runs the test files that failed
recent gates, quietly and with `--bail`. They are the `failedTests` of
`merge` log entries from the last 3 hours (`recentFailedFiles`), passed
in `SPLATES_RECENT_FAILED_FILES`, those still in the tree.

If they fail again the gate stops there with that report, which
attribution retests as usual. If they pass, the full suite runs as
before, so no test is skipped. The recent pass uses the same workers as the full run.

## Phase times

Each whole gate run's time goes in its `merge` log entry as `gate`: the
workers it was given, the one-minute load when it started (the raw
average, the gate before's share included), and `ms` by
phase. The gate names a file in `SPLATES_GATE_PHASES`; `dev premerge`
appends a line per phase (`PhaseTimer`): `biome`, `typecheck`, `scry`,
`recent`, `server tests`, `web tests`. The gate sums them and adds `setup`,
the rest of the run: `postRewrite`'s `bun install` and the command's own
start. A retest of named files records nothing; a later whole run replaces
the earlier one's.

## History

Until 2026-10-23, heavy-job slots (`HeavyJobs`, `SPLATES_HEAVY_JOBS`) and
a core budget (`SPLATES_HEAVY_CORES`) made hooks, test runs and installs
queue behind each other. The premerge lock already ran the suite one at a
time, so they only made short work wait behind it, and were removed.

On 2026-10-25 a job scheduler for the machine (`packages/server/jobs`,
`splates run`, pools, backfill, preemption) took this lock's place; its
edge cases cost more than it saved, and on 2026-10-26 it was removed for
this lock again.

## Where

- `packages/server/server/premerge.ts`: `premergeLockOfMachine`,
  `PREMERGE_TIMEOUT_MS`, `PREMERGE_HOLD_MS`, `TimedLock`
- `packages/server/merge/gate.ts`: `MergeGate`, setting `SPLATES_CORES`
- `packages/server/merge/cores.ts`: `gateCores`, `GateTrail`, `lingering`
- `packages/server/merge/merge.ts`: the `timeout` refusal
- `packages/server/merge/recent-failures.ts`: `recentFailedFiles`
- `packages/splates/dev/premerge.ts`
- `packages/server/testing.ts`: `Testing`

A waiter whose branch comes to conflict with the base gives its ticket up through
the same `AbortSignal`, so a doomed merge does not hold a place in the line.

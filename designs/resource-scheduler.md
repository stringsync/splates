# A job scheduler for the machine

A design record, decided with the user on 2026-10-25 in a design talk that
began from "replace the single merge-gate lock with a resource scheduler".
It records what was settled and what is open; the lane that carries it out
is named at the end, and this file gains dated "built" paragraphs as it
lands.

## The problem (settled)

Everything splates runs, runs on the person's machine beside their own work
and every other agent's, and nothing caps how many agents they run. Until
now the only protection was a machine-wide premerge lock, so the whole
suite ran one at a time, and a rule in the skill: an agent asks the person
with a permission card before anything else heavy, and the person allows
each run by hand. Heavy-job slots and a core budget had been tried and
removed (2026-10-23), since beside the lock they only made short work wait
behind the suite.

The person wants neither the lock nor the cards: this is the classic
problem of jobs, a fixed amount of compute, and when to run each, and it
should be solved the classic way. And nothing is to be called "heavy": a
job is a job, and what it needs is said separately, as its request.

## Off the shelf (settled: write our own)

Searched 2026-10-25. Nothing is a library for this. Slurm does not run on
macOS. HTCondor and Nomad are batch schedulers that run on a Mac, each with
its system of daemons and its config language. HyperQueue (`hq`, MIT, one
Rust binary, a server and workers that need no cluster) is the closest in
shape, with resource pools, requests, priorities and time limits, but no
preemption, no backfill, no view of load it did not start, and Linux-only
releases. task-spooler, pueue and nq are command queues with slots and no
resources. GNU parallel admits by `--load` and `--memfree`, but runs a list,
not submissions. Snakemake, Nextflow, Ray and Temporal's resource-based
slot supplier are each the wrong shape. Nothing in JavaScript does
admission by resources.

So splates writes its own, modelled on HyperQueue for the shape and on
Slurm for the two policies HyperQueue lacks.

## The model (settled)

In `packages/server/jobs/`.

**Pools.** The machine offers named resource pools, each a quantity: `cpus`
(the cores less a reserve of two for the person, the server and git), `mem`
(megabytes, less a share held back), and `suite`, one item, the tree a
whole test suite runs in. Pools are logical, as HyperQueue's are: the
scheduler guarantees no pool is oversubscribed by what it started, and
attaches no other meaning. macOS enforces nothing, and `nice` stays as a
courtesy beside the scheduler, not a mechanism.

**What is free** is the pool's capacity less what the scheduler allocated,
less what the machine measures in use beyond that: the one-minute load
average for `cpus`, memory in use for `mem`. That is how the person's own
work counts without being scheduled, the idea of GNU parallel's `--load`
and `--memfree`.

**A job** is a command, where it runs, who submitted it (a task, a
conversation), and a request: an amount of each pool it needs, `cpus` as a
range so a gate takes what is free between half the cores and all but two
(as `gateCores` sized it), a walltime past which it is killed, and whether
it is requeue-able. It carries a priority, a signed integer as HyperQueue's,
set by the code path that submits it, never by the agent: a merge's gate
high, a task's start normal, an agent's own checks and runs low. Priority
ages, a step per minute waited up to a cap, so nothing starves.

**Scheduling** runs on every event (a submit, a finish, a tick that re-reads
the machine): the queue in priority order, then age; each job that fits
starts. When the head job cannot fit, it reserves the earliest time it can,
counting on the running jobs ending when accounting expects, and EASY
backfill starts lower jobs behind it only when they fit now and will be out
of its way by then: done before its reservation, or small enough to run
beside it. This is the point of the design: it is the classic answer to
short work waiting behind the suite, which is why the slots were removed
last time.

**Preemption.** A job that cannot fit may stop a running requeue-able job of
lower priority, the lowest first, when that makes room; a gap of at least
ten (Nomad's rule) so near-equals never thrash. The stopped job goes back to
the queue at its original age and starts over.

**Walltime.** A job past its walltime is told it expired and its allocation
freed; the holder kills what it runs, as the gate kills its command at
three minutes today. A holder renews the walltime at each bounded step, as
a batch's gate rounds add up past one.

**Accounting.** Every job's allocation, duration and outcome is recorded,
by command; a command's expected time, which backfill and reservations
need, is its past runs' median, else its walltime. The merge log's `gate`
entries were the first such records.

## Where it runs (settled)

In `splates server`, the daemon the classic designs have: priority,
backfill and preemption are one global decision over one view of capacity.
A CLI command reaches it as other commands do, through the `SPLATES_DEV`
the server sets for every agent it starts, and holds its job open over a
server-sent event stream: the stream's end is the job's end, so a holder
that dies frees its allocation by dying.

With no server answering, a command takes the suite's file lock itself and
runs unscheduled; and the scheduler holds that same file lock while any job
it started holds `suite`, so the two paths exclude each other and the lock
stays the one machine-wide truth for that resource. The premerge lock does
not go, then: it becomes the exclusive resource's lock and the fallback.

## What it replaces (settled)

- The premerge lock as the way merges take turns: `MergeGate.reserve` keeps
  its `PlacedLock` view, backed by a job, so batches and "Waiting to merge
  · next" stand.
- `SuiteGrants`, the `/suite` route, `isWholeSuite`, the half-the-files
  refusal: an agent's suite run is a low, requeue-able job.
- The run-command permission card for anything whose cost is compute: an
  agent runs `splates run -- <cmd>` and waits its turn. The card stays for
  a cost that is not compute: tokens, a write outside the repository.
- The word "heavy", everywhere.

## Open

- The reserve of two cores and the memory share held back are guesses to
  measure against the gate's phase times once a week of jobs is in.
- Whether the person's own commands (from no conversation) should submit as
  jobs at the highest priority, so the page shows them, or stay invisible
  as measured load. They stay invisible for now.
- Persisting the queue across a server restart. Waiting jobs are lost with
  the server; a holder whose stream ends while it waits takes the suite's
  lock directly instead.
- The person's own terminal has no `SPLATES_DEV`, so its merges take the
  suite's lock directly and are invisible to the queue. A record of the
  running server's port under the splates home would let them schedule
  too; it is not written yet, since a test's CLI must never reach the
  person's server.

## Built (2026-10-25)

`packages/server/jobs/`: `JobScheduler` over `Pools` (`MachinePools` from
the machine's sensors), `Accounting` in the machine's storage, `JobRoutes`
on `/api/jobs`, `JobClient` and `RemoteJob` over the event stream,
`JobLock` giving a job the `PlacedLock` shape with the premerge lock as its
fallback, and `gateJob` sizing a gate's request. The merge gate and `dev
premerge` take their turn through `gateLockOfMachine`; the gate's test
workers are its allocation's cpus. `/api/machine` carries the listing.

## The lane

Lane 83, "Resource scheduler": the task `resource-scheduler` lands this
record, `packages/server/jobs/`, and the merge gate and `dev premerge` on
it; then #1395 (dev test and dev fix as jobs, the grants go), #1396
(`splates run`, the install hooks), #1397 (the Machine page's queue and
pause) and #1398 (the words: skill, CLAUDE.md, AGENTS.md, notes, code).

## Built, the rest (2026-10-25)

- #1395: `splates dev test` and `splates dev fix` submit themselves as jobs
  (a whole suite is a low, requeue-able job on the suite pool; scoped runs
  and fix ask for cpus) and run at once with no server. `SuiteGrants`, the
  approve-suite command and route, `isWholeSuite` and the half-the-files
  refusal are gone.
- #1396: `splates run -- <cmd>` submits any command as a job and prints its
  place; a task's `postCheckout` install takes its turn as a job.
- #1397: the Queue page lists running and waiting jobs with the head job's
  reservation; the person can pause and resume job starts.
- #1398: the words. The skill, CLAUDE.md and AGENTS.md send compute to
  `splates run` and keep the run-command card for a cost that is not
  compute; `notes/premerge-lock.md` became `notes/jobs.md`; "heavy" left
  the live notes and code (the older records above keep it as history).

---
description: How test runs, installs and merge gates share machine-wide heavy-job slots and a core budget, and how a job inside a slot avoids deadlocking
---

Several agents testing at once on one machine ran it out of memory, so heavy
work takes one of the machine's heavy-job slots: `HeavyJobs` from
`webappwiz/system`, set up in `packages/server/server/heavy.ts`, kept under
the machine home so every server and worktree on the machine shares one cap.
`SPLATES_HEAVY_JOBS` sets it, 2 by default, because one `splates dev test`
takes about 7 cores and 7.3 GB. `splates heavy -- <cmd>`, `splates dev
test`, the `postCheckout`, `postRewrite` and `preMerge` hooks and the shared
browser's start all take a slot.

Cores are claimed separately (`server/cores.ts`): `SPLATES_HEAVY_CORES`, else
all but two, kept for the server, agents and git. A process running inside a
slot or claim finds `SPLATES_HEAVY` or `SPLATES_CORES` in its environment
and claims nothing more, which is how a gate's `dev test` does not wait on
itself. A merge's claim goes first, ahead of waiters under two minutes old.
`Testing` gives each test its own slots and strips those variables.

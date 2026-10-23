---
description: How test runs, installs and merge gates share machine-wide heavy-job slots and a core budget, and how a job inside a slot avoids deadlocking
---

Several agents testing at once on one machine ran it out of memory, so heavy
work takes one of the machine's heavy-job slots: `HeavyJobs` from
`webappwiz/system`, set up in `packages/server/server/heavy.ts`, kept under
the machine home so every server and worktree on the machine shares one cap.
`SPLATES_HEAVY_JOBS` sets it, 1 by default: two test runs heat the host too much while the
person works. This is the backstop for the merge gate fallback and projects
with no cloud. `splates run -- <cmd>`, `splates dev
test`, the `postCheckout`, `postRewrite` and `preMerge` hooks and the shared
browser's start all take a slot.

Cores are claimed separately (`server/cores.ts`): `SPLATES_HEAVY_CORES`, else
all but two, kept for the server, agents and git. A process running inside a
slot or claim finds `SPLATES_HEAVY` or `SPLATES_CORES` in its environment
and claims nothing more, which is how a gate's `dev test` does not wait on
itself. A merge's claim goes first, ahead of waiters under two minutes old.
`Testing` gives each test its own slots and strips those variables.

These slots and cores are the machine's own, taken by a job that runs here:
`splates run -- <cmd>` and `splates dev test` first wait on the scheduler's
pool-wide queue for a runner, then a runner they make themselves in the
project's cloud (`runners-without-server.md`), and run here as above only in
a project that names no cloud. See
`heavy-jobs-on-runners.md`.

Agents may run a fraction of the tests directly, a test file or two with
`bun test <path>`, when that is quicker than a runner. Never a whole suite,
an install or a build on the person's host; the whole suite is the merge
gate's. `splates dev test --local` is internal to runners and the gate,
which already hold a heavy slot or core claim.

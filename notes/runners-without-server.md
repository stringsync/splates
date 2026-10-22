---
description: How `splates run` and `splates dev test` make and use runners of their own in the project's cloud with no `splates server` (tagged droplets, SSH, git push), share the worker budget, reap idle ones, and refuse rather than run here
---

The person asked (2026-10-22) that `splates run` never depend on the server,
which may not be running: in a project whose `splates.config.ts` names a
`cloud`, it runs on a runner, making one when none has room, within the
budget, and fails loudly (`no_runner`, exit 31) rather than quietly running
here when it can have none. Only `--local` runs it here. A project that names
no cloud runs here as before.

Order: the server's pool first (`runOnRunner`, `heavy-jobs-on-runners.md`);
when it is unreachable or answers `local`, `runOnDirectRunner`
(`server/direct-run.ts`) with `DirectRunners` (`workers/direct.ts`). The
merge gate inside the server does not go on to these.

Nothing is kept here about them but the budget and the ledger: each is a
machine tagged `splates-run:<name>`, listed from the cloud, and the runner
itself says what it holds. Under `~/direct` on the runner (user `splates`)
each job writes `jobs/<id>.job`, `cpus memory pid started`, reserved under a
`mkdir` lock with `-` for a pid until the job takes it up (5 minutes), so a
runner takes as many jobs as fit in its size's CPUs and memory, as the pool's
runners do; a dead pid frees its room. `last-used` says when it last ran one.

Placement, under a `FileLock` in `~/.splates/direct-runners/place.lock` so
two `splates run`s here never race: reserve on the cheapest runner up with
room; else wait for one booting whose room, less the claims of jobs here
already waiting for it (`claims.json`, by pid), holds the job; else make the
cheapest size that holds it (`runnerSizes`, shared with `CloudWorkers`). Past
the budget it waits while a runner that could hold it is busy, and refuses
when none could. A size the cloud refuses (`TypeRefused`) is skipped for the
next cheapest.

A runner boots from the worker snapshot when there is one (any version: a job
needs bun and git, not splates), else the stock image with the recipe, then
its user data adds the runner key's public half to `splates`'s
`authorized_keys` and marks it ready. The key is made once with `ssh-keygen`
and kept in the device's creds (`SPLATES_RUNNER_SSH_KEY` and `_PUBLIC_KEY`),
written to a 0600 temp file only while a command runs. Host keys are trusted
on first use and kept per runner name, since the cloud reuses addresses.
Nothing of the person's creds reaches a runner.

A job is the snapshot commit (`JobSnapshot`) pushed with git over SSH to the
project's bare clone there (`refs/splates/jobs/<id>`), so only missing objects
go, then `directJobScript` run in bash over SSH: a detached worktree, the
`prepare` step and the command in a process group of their own with
`SPLATES_HEAVY=runner` and `SPLATES_CORES`, killed when SSH's stdin closes (the
caller hung up) or past the timeout (exit 124). Files the job asks back come
as base64 lines from a second SSH. Each job is a `job` row in the ledger.

Cost: each runner is a life in the shared `worker-budget.json` (which now reads
itself again before each change, so the server and `splates run` keep each
other's; `splates budget show|set|raise|end` read and write that document
directly when no server answers, through the same `WorkerBudgetRoutes`, so a
person past the budget can raise it) and `runner` / `runner-ended` rows in the spend ledger, so Billing
shows it. `splates run` leaves a detached `splates runners reap --watch 11m`
behind it, one on the machine at a time (its pid in
`~/.splates/direct-runners/reaper.pid`), which looks every 11 minutes for as
long as any runner is up and deletes those idle 10 minutes, every idle one
once the day's or month's limit is spent, and any that never booted or stay
unreachable past 15 minutes. A machine asleep or off reaps nothing, so a
runner can outlive it until the next `splates run` here. `splates runners
list` shows them.

Measured 2026-10-22 on DigitalOcean `s-4vcpu-8gb`: a cold run (no runner up)
about 3 minutes to output; the next on the same runner about 8 s, most of it
`prepare`; the whole suite via `splates dev test` about 4 minutes.

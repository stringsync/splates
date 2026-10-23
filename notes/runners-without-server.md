---
description: How `splates run` and `splates dev test` make and use runners of their own in the project's Fly app with no `splates server` (tagged machines reached through Fly's proxy, the job channel, local claims), share the worker budget, leave idle ones to stop themselves, and refuse rather than run here
---

The person asked (2026-10-22) that `splates run` never depend on the server,
which may not be running: in a project whose `splates.config.ts` names a
`cloud`, it runs on a runner, making one when none has room, within the
budget, and fails loudly (`no_runner`, exit 31) rather than quietly running
here when it can have none; its refusal tells agents they may run a test
file or two directly (`bun test --changed` or explicit file paths), use a
focused `splates dev test --changed` in this repo, or wait for a runner, leaving the
whole suite to the merge gate; there is no flag to run it here (the person had
`--local` taken out). A project that names
no cloud runs here as before.

Order: the server's pool first (`runOnRunner`, `heavy-jobs-on-runners.md`);
when it is unreachable or answers `local`, `runOnDirectRunner`
(`server/direct-run.ts`) with `DirectRunners` (`workers/direct.ts`). The
merge gate inside the server does not go on to these.

Only Fly.io runners are made this way (since 2026-10-22, when SSH went):
with a DigitalOcean `cloud`, `withRunners` refuses with `no_runner` and
says to start `splates server`, whose `CloudWorkers` still make
DigitalOcean's until it is removed. Each runner is a machine in the
project's app whose metadata says `splates-run: <name>`, listed from the
Machines API, and reached as the server reaches its own
(`FlyRunners`, `cloud/fly-runners.ts`; `heavy-jobs-on-runners.md`): through
`https://<app>.fly.dev/api/jobs` with its id in `fly-force-instance-id` and
the bearer secret its maker put in its env, which the Machines API gives
back to whoever holds `FLY_API_TOKEN`. A stopped one is started first. So
nothing dials in, and no key of this machine's is needed.

What this machine's jobs hold is kept here, in
`~/.splates/direct-runners/claims.json` (`RunnerClaims`): each job's claim
of CPUs and memory on the runner it waits for or runs on, by pid, freed when
the job ends or its process is gone, and when each runner last ended a job.
Placement, under a `FileLock` in `~/.splates/direct-runners/place.lock` so
two `splates run`s here never race: the first runner (started ones first,
then the cheapest) whose size, less the claims on it, holds the job; else
make the cheapest size that holds it (`runnerSizes`, as `FlyWorkers` does).
Past the budget it waits while a runner that could hold it is up, and
refuses when none could. A size Fly refuses (`TypeRefused`) is skipped for
the next cheapest. Jobs from `splates run` on another computer are not
counted, so a runner shared that way may be overfilled; the runner stopping
itself when idle (#1070) means nothing here deletes a runner by time: a
stopped one is a candidate like any other and a job starts it. The claims
file still says what this machine's jobs hold.

A job opens the job channel over that socket with a `WorkerRegistry` of the
CLI's own: the runner says its hello once sent `ready`, the CLI ships the
snapshot commit as a bundle of what the runner lacks, and output, exit code
and files come back as they do through the server, with `SPLATES_HEAVY=runner`
and `SPLATES_CORES` set. Hanging up ends the job on the runner. A checkout's
splates hands a runner it made its own build first, as the server does.

The runner cap (`splates budget set runners`, 16 by default) is counted from
the cloud's own list, the server's workers and `splates run`'s runners
together; past it a job waits as past the day limit, saying so, and is refused
when none that could hold it is up. With no server `budget show` cannot count
and prints `?` runners up.

Cost: each runner is a life in the shared `worker-budget.json` (which now reads
itself again before each change, so the server and `splates run` keep each
other's; `splates budget show|set|raise|end` read and write that document
directly when no server answers, through the same `WorkerBudgetRoutes`, so a
person past the budget can raise it) and `runner` / `runner-ended` rows in the spend ledger, so Billing
shows it. A runner stops itself `idle` (10 minutes, `splates budget set idle`)
after its last job, and the machine, made with `auto_destroy: false`, is kept
stopped; the next job starts it. `DirectRunners.settle` ends a stopped
runner's life in the budget at its last job plus the tail, from the server's
sweep and before each placement, so a laptop asleep leaves no spend counted.
Nothing deletes a runner by time: `splates runners delete <name>` does. `splates runners
list` shows them.

Measured 2026-10-22 on DigitalOcean `s-4vcpu-8gb`, over SSH before this path moved to Fly: a cold run (no runner up)
about 3 minutes to output; the next on the same runner about 8 s, most of it
`prepare`; the whole suite via `splates dev test` about 4 minutes.

Focused `splates dev test` runs are a development exception: `--changed`,
`--since <ref>`, file paths and `--test-name-pattern` select a portion to run
here against the actual worktree, using one worker by default. There is no
location flag. Unfiltered suites still use runners or the merge gate.

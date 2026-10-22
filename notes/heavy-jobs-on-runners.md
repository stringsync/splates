---
description: How `splates run` and `splates dev test` run on a runner: the pool-wide queue that places them, the runners made and stopped to meet it, a snapshot commit shipped as a bundle, output and files streamed back; and when they run here instead
---

A runner is a joined worker (not this machine's own `local`) that says
`jobs: true` in its hello and holds no state but a bare warm clone per project
under `<splates home>/runner/<hash of the project>/repo.git`.

`JobPool` (`workers/job-pool.ts`) is the pool-wide queue, over every project:
each job asks for CPUs and memory (`workers/job-size.ts`), and a runner takes as
many at once as fit in what it said it has in its hello (`cpus`, and `memory`
rounded to the GB, since a box sold as 8 GB tells the kernel a little less; a
runner from before says neither and is taken as 4 and 8). A job asks what its
project's `job` in `splates.config.ts` says, `{ cpus: 4, memory: "8GB" }` when
unset (a test run is about 7 cores and 7 GB, so CPUs are overcommitted; see
`cloud-digitalocean.md` for the runner size), or what `splates run --cpus
--memory` says for one command; `splates dev test` and the merge gate send the
project's. A job goes to a runner with room for it, one that already holds the
project's clone first, then the one with the most free CPUs, then memory, and
the rest wait first come, first served. A waiting job with room nowhere yet
reserves, on each placing pass, the runner nearest to having it (one it would
fit once empty, the most free room first), which no job behind it is placed
on, so a stream of smaller jobs cannot keep taking the room a bigger one
(`splates run --cpus 8` among default-sized jobs) waits for; the jobs behind
go to another runner or wait, and `short()` still counts the big job as a
runner to make. A job that can have no runner,
because none up, on its way or that can be made is big enough for it (none at
all: no provider, the day's or month's limit reached, a make that just failed),
is told `local`, and its caller runs it in this machine's
heavy-job slots (`heavy-jobs-and-cores.md`), so the hard stop never leaves a
job waiting.

`RunnerKeeper` (`workers/runner-keeper.ts`) makes the runners the pool wants:
one while any agent is live (made when the first starts), and a second only
while jobs wait that fit in no room left on the runners up or booting, counting
a booting runner's room by its type's `cpus` and `memory` (at most
`MAX_RUNNERS`, 2). Its `busy` keeps from `WorkerProvisioning`'s idle sweep each
runner running a job, all while jobs wait, and the first made while an agent
is live; any other is destroyed after 15 idle minutes (at once when its type
bills by the second, which is why a DigitalOcean runner's idle time need not
be rounded up). The day, month and rate limits in `workers/budget.ts` hold
over runners as over any made worker, with their 80, 90 and 100% warnings. A
runner that could not be made is not tried again for a minute.

A runner boots from the worker image (`Snapshots`, `workers/snapshot.ts`): the
recipe (`splates worker recipe`) applied to a stock image, with bun's package
cache warm from installing splates. A runner never waits for the image to be
built: with no fresh one (none yet, another splates version, a week old) it is
made from the stock image and runs the recipe in its user data before joining
(`WorkerSpec.recipe`), while the image is built in the background for the next
one; a failed build is not tried again for 10 minutes.

Measured 2026-10-22 on a real DigitalOcean account, from the droplet's create to
the runner joined (`splates worker list` connected, polled every 3-5 s): from the
stock image plus recipe about 2.5 minutes (`c-4` in sfo2 and `s-4vcpu-8gb` in nyc3
alike), from the image about 80 s (`s-4vcpu-8gb`, nyc3); the image's build took
about 3 minutes. Job queued to tests running could not be timed: a runner installs
splates from npm at the server's version, and 0.0.54 predates `jobs: true`, so the
pool saw no runner and sent each job here. That account could not order `c-16`,
`c-8` or any size over 4 vCPU (DigitalOcean's starting droplet limits), and orders
`c-4` only in blr1, lon1 and sfo2. The suite (1285 tests) runs in about 40 s at 8
in parallel on a 16-core Mac, so a smaller runner than `c-16` may now be enough.

A snapshot installs splates from npm at the server's version, which a
server run from a checkout may be ahead of (as the measurement above found). So such a server
hands each runner it makes its own build (`OwnBuild`, `workers/own-build.ts`):
the CLI bundled into one bun script on first ask, which the runner's user data
fetches once joined, with a token minted for it, from `GET /api/workers/join`
(a path the tunnel's Access already lets a worker's service token through),
and links in place of the snapshot's `splates`; a failed fetch leaves the
release. A joined runner that still says no `jobs` is named on its Runners
card.

`POST /api/jobs` (`RunnerJobs` in `workers/job-route.ts`) streams from the
start: a `queued` event with the position while it waits, then the job's
events, or `local`. A job whose runner is lost (the box gone, the link lost
past replay: `RunnerLost`) is run again on another runner once, with the first
kept out, then told `local`; output of the first try has already streamed, so
it shows again. Servers before the pool answered 409 `no_runner` for want of a
runner, which the caller still treats as `local`.

The caller (`runOnRunner`, `workers/job-client.ts`) sends the worktree, the
project's common git dir, the command, its env, the files it wants back and the
config's `prepare`. The server then:

1. snapshots the worktree (`JobSnapshot.take`): a commit parented on HEAD made
   with a scratch `GIT_INDEX_FILE`, so the agent's index and branch are
   untouched; uncommitted edits and untracked, unignored files are in it;
2. opens a `job` channel (`WorkerJobHost` on the runner, `runRemoteJob` here);
3. the runner answers `have` with `refs/splates/tip`, the last snapshot it
   fetched; the server ships `git bundle create ref ^tip` as data frames (the
   whole history for none), then `bundle {bytes}`;
4. the runner fetches it, adds a detached worktree, runs `prepare` via `sh -c`
   then the command with `SPLATES_WORKTREE` and `SPLATES_JOB_FILES` set (stdout
   and stderr both stream back as data frames), sends `exit`, then each
   requested file (`file {name,size}` then its bytes as data), then `done`;
5. the server streams NDJSON events to the caller (`out`, `file`, `exit`,
   `error`); the caller's exit code is the job's.

A caller that hangs up cancels the job: the runner kills the command and its
descendants and removes the worktree. Nothing of the person's creds reaches a
runner. `prepare` is a `splates.config.ts` setting (here `bun install` and the
page build, as `docker/worker.Dockerfile` does), run on every job; bun's cache
is what keeps it quick. `splates dev test` runs `./bin/splates dev test --local`
on the runner and gets its JUnit report back as a file. Files a `splates run`
command writes stay on the runner.

The merge gate is a caller too (`MergeGate` in `merge/gate.ts`): its jobs set
`first` in the request, which puts them ahead of ordinary jobs in the pool's
queue, and a retest at the base commit sets `commit`, which runs that commit of
the project instead of a snapshot of the worktree. See `merge-gate-attribution.md`.

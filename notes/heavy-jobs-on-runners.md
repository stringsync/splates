---
description: How `splates heavy` and `splates dev test` run on a runner: a snapshot commit shipped as a bundle over a job channel, prepared and run in a throwaway worktree, output and files streamed back; and when they run here instead
---

A runner is a joined worker (not this machine's own `local`) that says
`jobs: true` in its hello and holds no state but a bare warm clone per project
under `<splates home>/runner/<hash of the project>/repo.git`. `POST /api/jobs`
(`RunnerJobs` in `workers/job-route.ts`) picks the connected, undrained runner
with the fewest jobs; none gives `no_runner` (409), which the caller answers by
running the job here. Pool-wide queueing and making runners are separate work.

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
on the runner and gets its JUnit report back as a file. Files a `splates heavy`
command writes stay on the runner.

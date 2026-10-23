---
description: What the merge gate runs, on a runner or here, and how a failing test is blamed on the task, trunk, a flake or the environment before an attempt is charged; each failing test becomes a backlog task
---

The gate is `config.postRewrite && config.preMerge` as one shell
(`MergeGate` in `packages/server/merge/gate.ts`), with no gate when neither
is set, run with `SPLATES_TASK`, `SPLATES_WORKTREE` and `SPLATES_TEST_REPORT`
(a JUnit path under the git dir) and `SPLATES_PREMERGE`. Before taking the
merge-tree lock it waits for the machine's premerge lock, and the gate is
killed past 3 minutes (`premerge-lock.md`).

Under a `splates server` the gate goes to a runner instead (`runOnRunner`,
`heavy-jobs-on-runners.md`) with `first` set, so the pool queues it ahead of
ordinary jobs: `preMerge` runs there as `sh -c` on a snapshot of the rebased
tree, with `SPLATES_TEST_REPORT` pointing into `SPLATES_JOB_FILES`, and the
JUnit report comes back as the job file `report.xml` for attribution to read.
`postRewrite` (the install the coordinator's worktree needs) still runs here,
beside the job and outside any slot. No slot or cores are reserved then; a job
the pool sends `local` (no runner, budget spent, runner lost twice) runs the
gate here in a heavy-job slot as below.

When it fails, `attributeFailure` (`merge/attribution.ts`) needs a Bun JUnit
report, else the result is `environment`. It retests
only the failing files at the exact base commit and then in the task tree,
each a runner job (`MergeGate.run` with `at`, a job on that commit), or, run
here, in a detached scratch worktree at the base commit where `postRewrite`
runs first: `task`, `trunk`,
`flake` or `environment`. Only `task` spends an attempt; a `flake` reruns the
whole gate once; in every case the branch stays on the rebased commit the gate tested
(only what the gate wrote is dropped), so the agent can reproduce the failure.
Each failing test also becomes a backlog task `Tests failed: <name>`
(`merge/queue-failures.ts`) unless one with that subject is listed. An
existing `index.lock` holds the merge as `blocked` without charging.

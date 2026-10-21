---
description: What the merge gate runs, and how a failing test is blamed on the task, trunk, a flake or the environment before an attempt is charged; each failing test becomes a backlog task
---

The gate is `config.postRewrite && config.preMerge` as one shell
(`MergeGate` in `packages/server/merge/gate.ts`), with no gate when neither
is set, run with `SPLATES_TASK`, `SPLATES_WORKTREE` and `SPLATES_TEST_REPORT`
(a JUnit path under the git dir). Before taking the merge-tree lock it
reserves a heavy-job slot and half the machine's core budget, ahead of
ordinary waiters, so a landing is not starved by other agents' tests.

When it fails, `attributeFailure` (`merge/attribution.ts`) needs a Bun JUnit
report, else the result is `environment`. It makes a detached scratch
worktree at the exact base commit, runs `postRewrite` there, and retests
only the failing files there and then in the task tree: `task`, `trunk`,
`flake` or `environment`. Only `task` spends an attempt; a `flake` reruns the
whole gate once; in every case the branch is reset to its pre-rebase commit.
Each failing test also becomes a backlog task `Tests failed: <name>`
(`merge/queue-failures.ts`) unless one with that subject is listed. An
existing `index.lock` holds the merge as `blocked` without charging.

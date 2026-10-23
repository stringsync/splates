---
description: What the merge gate runs on this machine, and how a failing test is blamed on the task, trunk, a flake or the environment before an attempt is charged; each failing test becomes a backlog task
---

The gate is `config.postRewrite && config.preMerge` as one shell
(`MergeGate` in `packages/server/merge/gate.ts`), with no gate when neither
is set, run with `SPLATES_TASK`, `SPLATES_WORKTREE` and `SPLATES_TEST_REPORT`
(a JUnit path under the git dir) and `SPLATES_PREMERGE`. Before taking the
merge-tree lock it waits for the machine's premerge lock, and the gate is
killed past 3 minutes (`premerge-lock.md`).

The gate runs on this machine, one premerge at a time. There is no runner
pool, remote job or heavy-job slot; `premerge-lock.md` describes the lock.

When it fails, `attributeFailure` (`merge/attribution.ts`) needs a Bun JUnit
report, else the result is `environment`. It retests
only the failing files at the exact base commit and then in the task tree,
in a detached scratch worktree at the base commit where `postRewrite`
runs first: `task`, `trunk`,
`flake` or `environment`. Only `task` spends an attempt, and then only when it repeats the task's last
`tests_failed` (same base commit, or the same failing tests on any base:
`merge/charge.ts`); a `flake` reruns the
whole gate once; in every case the branch stays on the rebased commit the gate tested
(only what the gate wrote is dropped), so the agent can reproduce the failure.
A `tests_failed` also names what landed on the base since the branch's last
base (the merge-base before the rebase): `landedSince` (`merge/landed.ts`)
filters `git log <old>..<new>` to the failing test files, the files they
import by relative path (one level), and the task's changed files, falling
back to the whole range under ten commits or a count. Each commit's task comes
from `service.finished` by its landed commit. The same lines are kept as the
merge event's `landed` fact.
Each failing test also becomes a backlog task `Tests failed: <name>`
(`merge/queue-failures.ts`) unless one with that subject is listed. An
existing `index.lock` holds the merge as `blocked` without charging.

---
description: What the merge gate runs and how a failing test is blamed on the task, trunk, a flake or the environment; read when a merge fails tests_failed or you change the gate
---

The gate runs on this machine, one premerge at a time, and a failing test is
blamed on the task, trunk, a flake or the environment before any attempt is
charged. Only a failure pinned on the task, and repeating its last one,
spends an attempt. Each failing test also becomes a backlog task, or one
task for them all when several fail together and none is pinned on the code.

## The gate

- It is `config.postRewrite && config.preMerge` run as one shell, and there is
  no gate when neither is set.
- It runs with `SPLATES_TASK`, `SPLATES_WORKTREE`, `SPLATES_PREMERGE` and
  `SPLATES_TEST_REPORT`, a JUnit path under the git dir.
- `config.preLock`, when set, ran before that wait; its failure is refused
  the same way as an `environment` failure (`premerge-lock.md`).
- Before taking the merge-tree lock it waits for the machine's premerge lock
  (`premerge-lock.md`).
- It is killed past 3 minutes.
- What `preLock` and the whole gate print goes, as it prints, to
  `splates-merge-<n>-<step>.log` in the task's git dir, named on its step in
  `mergeSteps` as `output`; `/api/tasks/:task/merge-output/:n` follows it
  while the step runs, for the merge card's step to open in the side pane.
  Retests write none, and the files go with the worktree.
- There is no runner pool, remote job or heavy-job slot.

## Attribution

- `attributeFailure` needs a Bun JUnit report; without one the result is
  `environment`.
- It retests only the failing files, first at the exact base commit in a
  detached scratch worktree where `postRewrite` runs first, then in the task
  tree.
- The result is `task`, `trunk`, `flake` or `environment`.
- Only `task` spends an attempt, and only when it repeats the task's last
  `tests_failed`: the same base commit, or the same failing tests on any base.
- A `flake` reruns the whole gate once.
- In every case the branch stays on the rebased commit the gate tested, with
  only what the gate wrote dropped, so the agent can reproduce the failure.
- An existing `index.lock` holds the merge as `blocked` without charging.
- In a batch, attribution runs against the stack's tip with the base as
  baseline, and a `task` result is narrowed to one member by `blame`,
  which runs the failing files at each member's head bottom up
  (`merge-pipeline.md`, Batches).

## What the failure reports

- A `tests_failed` names what landed on the base since the branch's last base,
  the merge-base before the rebase.
- `landedSince` filters `git log <old>..<new>` to the failing test files, the
  files they import by relative path (one level), and the task's changed
  files.
- It falls back to the whole range under ten commits, or a count.
- Each commit's task comes from `service.finished` by its landed commit.
- The same lines are kept as the merge event's `landed` fact.
- Each failing test becomes a backlog task `Tests failed: <name>` unless one
  with that subject is listed. When two or more fail in a gate blamed on the
  `environment` or a `flake`, they become one task instead, `Tests failed
  together in <task>'s gate: <n> tests (<kind>)`, naming each: sixteen
  page tests timing out at once in a loaded gate (2026-10-23) were one event,
  not sixteen bugs, and had been queued as sixteen tasks.

## Where

- `packages/server/merge/gate.ts`: `MergeGate`
- `packages/server/merge/attribution.ts`: `attributeFailure`
- `packages/server/merge/charge.ts`: the repeat rule
- `packages/server/merge/landed.ts`: `landedSince`
- `packages/server/merge/queue-failures.ts`: the backlog tasks

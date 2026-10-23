---
description: How splates merge lands work: refusals, squash, rebase, gate, compare-and-swap fast-forward; read when merge stops or you change its steps or attempt budget
---

`merge()` never makes a merge commit. It refuses what cannot land, squashes
the task, rebases onto the base, runs the gate under the premerge lock, then
fast-forwards the base with a compare-and-swap and discards the worktree.

## Refusals and attempts

- A task has `mergeRetryCount` attempts, 5; `splates retry` grants more.
- Before spending one it refuses a dirty tree, a branch tracking `SPLATES.md`,
  unchecked `## Blocked` questions or `## Next` steps, a lease held by another
  process, and an exhausted budget.
- Only a conflict, or a `tests_failed` attributed to the task that repeats its
  last one, spends an attempt. Flakes, environment failures and timeouts do
  not.
- A repeat is the same `rebasedOnto` base commit, or the same failing test
  names on any base. Each failure is recorded in `gateFailures` with its
  `rebasedOnto` and whether it was `charged`, so the next can compare; a first
  failure, or one on a base that moved, is free.
- There is no backoff, since each attempt is the agent's try at a fix and the
  cap stops a task retrying forever. 5 (raised from 3) leaves room for real
  fixes without one task holding the premerge lock for hours.

## Squash

- `--message` squashes the task to one commit first; leaving it off keeps each
  commit.
- A message under five characters is refused, after agents landed commits
  titled "X".
- The squash replaced a `git reset --soft` recipe the skill used to carry, and
  the same change dropped `## Done` from plans, since the git log records
  steps.

## Rebase, gate and landing

- It rebases onto the base before waiting for the premerge lock, so a conflict
  stops the merge before the wait.
- Holding the lock, it rebases again onto whatever landed meanwhile, a no-op
  when nothing did. That second rebase is the loop's, so a conflict is one
  refusal and one charged attempt.
- A conflicted rebase is left in progress so the agent has the markers, and
  the gate runs on the rebased tree.
- Landing is `update-ref <base> <head> <onto>`, a compare-and-swap, and the
  checkout holding the base is updated with `read-tree -m -u`.
- If the base moved meanwhile, the loop rebases and gates again without
  charging.
- On success it `cd`s to the main tree first, since it usually runs from the
  tree it deletes, then discards the worktree, frees the dev slot, deletes any
  pushed branch and takes the queued tasks the task had taken off the list.

## After a stop

- A `conflict` or `merge_failed` leaves the rebase in progress.
- A `tests_failed` or `timeout` leaves the branch at the rebased commit the
  gate ran on (`testedHead`), not its pre-rebase commit.
- Every attempt prints the notes' descriptions, which gate nothing.

## Events

- Once it has the premerge lock, a merge logs `merge start`.
- It logs `merge queued` first when the lock was not had within a second
  (`QUEUED_AFTER_MS`; a `Lock` cannot be tried without waiting).
- Each later step names the first in `began`, the final `merge` event too, so
  the page folds them into a queued line and a started line that becomes
  Merged or Merge failed.

## Where

- `packages/server/merge/merge.ts`: `merge()`
- `packages/server/merge/charge.ts`: the repeat rule

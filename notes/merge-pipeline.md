---
description: How splates merge lands work: refusals, squash, rebase, gate, compare-and-swap fast-forward; read when merge stops or you change its steps or attempt budget
---

`merge()` never makes a merge commit. It refuses what cannot land, squashes
the task, rebases onto the base, runs the gate under the premerge lock, then
fast-forwards the base with a compare-and-swap and discards the worktree.

## Refusals and attempts

- A task has `mergeRetryCount` attempts, 5, and apart from them
  `mergeConflictCount` conflicted rebases, 10, since with many agents on one
  file a conflict is the base moving, not the task failing; either spent
  stops it on `budget_exhausted`, and `splates retry` gives both back.
- A merge whose last refusal was a conflict takes a premerge ticket `ahead`
  (`TicketedLock`, named with `!` to sort first): behind only the gate
  running, the waiter marked `next` and other tickets ahead, so its
  resolution is not stale by the time it gates.
- `splates retry` is the person's: the agent asks with a run-command card
  naming it, and the page's Grant on that card, or on the line of a merge
  refused `budget_exhausted`, grants from the page and sends the agent
  `[SPLATES RETRIED]` to merge again. The page grants rather than allowing the
  agent to run it, so an agent never grants itself attempts.
- Before spending one it refuses a dirty tree, a branch tracking `SPLATES.md`,
  unchecked `## Blocked` questions or `## Next` steps, a lease held by another
  process, and an exhausted budget.
- Only a `tests_failed` attributed to the task that repeats its last one, or
  a `merge_failed`, spends an attempt; a conflict spends from its own budget. Flakes, environment failures and timeouts do
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
  stops the merge before the wait. While it waits (`follow`'s poll, or a timer
  with no batch), each move of the base is checked against the branch with
  `git merge-tree --write-tree`; a conflict gives the wait up, the ticket
  leaves the line, and the rebase refuses it as `conflict`. The rebase stays
  the final word: the check only refuses earlier.
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

## Batches

Merges waiting for the premerge lock at once gate as one batch, a merge
train (`packages/server/merge/batch.ts`, `follow.ts`, `split.ts`,
`blame.ts`). Each gated merge landing locally (never with a central remote)
posts an offer in the project's `merge-batch` collection while it waits and
answers invitations meanwhile (`follow`); the squash happens before the wait,
so a batch stacks the squashed commit. The merge that takes the lock leads:
`MergeBatch.form` invites the live offers for its base oldest first, up to
`MERGE_BATCH_CAP` (4, the leader included), each onto the tip the one before
made; a follower stacks by `reset --hard` to its own head and `rebase <tip>`,
or declines on a conflict and is not asked again. An offer whose pid is gone
is dropped whatever hostname it was written under, since macOS renames the
host with the network. The leader gates the tip
once in a detached checkout, `.gates/<leader>-splates-batch` in the
worktree root (`MergeGate.checkout`, where `postRewrite` installs), then `landTested` moves the base to the tip with one
compare-and-swap and each follower is told `landed`; every process ends its
own task (`finishLanding`), so a follower's merge event has its own wait,
`commit` and files, and `batch` names the tasks gated together, leader first.
Outcomes keep that batch membership too, recovering older ones from the
journal when available. Merged cards and merge log lines name the other
tasks. Stats counts batched tasks and successful shared landing gates,
counting each gate on its leader; their difference is the separate gates
saved, excluding failed attempts.

Until 2026-10-26 that checkout sat in the leader's git directory
(`.git/worktrees/<leader>/splates-batch`), where biome finds no
`package.json`: every batch's gate failed its checks before any test ran,
read as inconclusive, and dissolved, so no batch ever landed.

Only the tip is gated, as merge trains do: every landed commit is inside a
tree the whole suite passed on, never gated alone.

A failing batch is settled by attribution against the stack (`splitBatch`):
`task` walks the stack bottom up running the failing files at each member's
head (`blame`), and the first they fail with is refused `tests_failed` with
`rebasedOnto` the stack under it (so it charges only a same-tests repeat), its
branch back on its own head and the stack commit named to reproduce on; the
batch re-forms without it and gates again. A leader found culprit is refused
as a lone merge is and the followers go on alone. `trunk` refuses every
member, held and free. `flake` reruns the gate on the stack. An inconclusive
result, a timeout or a base that moved dissolves the batch: the followers wait
on, back on their own heads, and the leader gates alone, the log keeping the tail of what the batch gate printed. A follower's branch
sits on a stack only while that batch is live, so a later plain rebase onto
the base never replays another task's commits. A follower learns its result
from the collection and gives its lock wait up through an `AbortSignal`
(`TicketedLock.acquire`); the `TimedLock` hold starts over at each gate run
(`renew`), so a batch's rounds fit it.

---
description: How splates merge lands work: refusals before an attempt is spent, squash with --message, rebase, gate, a compare-and-swap fast-forward of the base, then the worktree goes
---

`merge()` in `packages/server/merge/merge.ts` never makes a merge commit.
Before spending one of the task's attempts (`mergeRetryCount`, 3; `splates
retry` grants more) it refuses a dirty tree, a branch tracking `SPLATES.md`,
unchecked `## Blocked` questions or `## Next` steps, a lease held by another
process, and an exhausted budget. `--message` squashes the task to one
commit first, and a message under five characters is refused, after agents
landed commits titled "X"; leaving `--message` off keeps each commit. The
squash replaced a `git reset --soft` recipe the skill used to carry, and the
same change dropped `## Done` from plans, since the git log records steps.

It rebases onto the base, leaving a conflicted rebase in progress so the
agent has the markers, then runs the gate on the rebased tree. Landing is
`update-ref <base> <head> <onto>`, a compare-and-swap, and the checkout
holding the base is updated with `read-tree -m -u`; if the base moved
meanwhile the loop rebases and gates again without charging. On success it
`cd`s to the main tree first (it usually runs from the tree it deletes),
discards the worktree, frees the dev slot, deletes any pushed branch and
takes the queued tasks the task had taken off the list. Every attempt prints
the notes' descriptions, which gate nothing.

---
description: Each task's SPLATES.md sits at its worktree root excluded from git, with a copy in repo state, so it outlives the checkout and never lands on trunk
---

`SPLATES.md` (`PLAN_FILE` in `packages/server/plans/plan.ts`) is the task's
plan, at the worktree root and excluded from git: it is never on a branch,
so never reaches trunk, and `merge` refuses a branch that tracks it.
`PlanStore` keeps a copy in repo state at `plans/<task>.md`; on a worker
that copy is on the coordinator's disk, so the plan survives the clone being
swept away, and `TaskBranches.restorePlan` puts it back after a re-clone.
The page's task dialog shows that copy, and merge keeps the last one in
`finished/`.

The plan's h2 sections are fixed: `## Goal` (its first line is what
`splates list --files` shows), `## Next`, `## Verification`, `## Demo`,
`## Blocked` (questions only a person can answer, `- [ ] N.` items with
`- (a)` pick-one, `- [a]` pick-any or `- a.` ordered choices) and
`## Outcome`, kept with the merge record and shown on the merged card. Merge
refuses while any question or step is unchecked.

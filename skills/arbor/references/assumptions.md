# Checking a system's assumptions

Each system keeps the assumptions made about it in
`.arbor/assumptions/<system>.md`, named as `arbor.systems.ts` names it, so the
user can see what agents took for granted in one part of the code, and which
of those calls they later went against. Check yours against it before you
squash for `arbor merge`, so what you write lands with the task. A task that
ends in `arbor remove` lands nothing, so it skips this.

## The file

One `- ` line per assumption, oldest first: what was chosen, then the date and
task it came from. A later decision that goes against it goes on a `→ ` line
under it, which is never deleted, so the file keeps the history:

```markdown
# board

- A todo dropped on its own spot writes nothing. (2026-10-14, drag-todos)
- A stale todo shows as a muted card. (2026-10-10, stale-todos)
  → contradicted 2026-10-14 in stale-badge: the user picked a "stale" badge
- Lanes sort by when they were made. (2026-10-11, lane-order)
  → replaced 2026-10-13 in lane-drag: assumed lanes keep the order they are dragged to
```

`→ contradicted` is for a decision the user made: an answered question, a
challenged assumption, or what they asked for in chat. `→ replaced` is for an
assumption of a later task, an agent's call the user never made. Make the file
when you first record an assumption about its system.

## The check

1. `arbor systems --task <task>` names the systems your task touches. When it
   names none, skip the rest.
2. Hand the check to a subagent on the cheapest model your harness has, so the
   files it reads stay out of your context; without subagents, do it yourself.
   It only reads, so it needs no part. Tell it:
   - the task, so it can `arbor show <task>` for `## Assumptions` and
     `## Blocked`;
   - every decision the user made in chat that `ARBOR.md` does not hold;
   - the systems, and to read each one's `.arbor/assumptions/<system>.md`;
   - to report each recorded assumption that one of the task's decisions or
     assumptions goes against, quoting both, and whether the code outside the
     task's diff still follows the old one, and to change nothing.
3. Write each one it reports as a `→ contradicted` or `→ replaced` line under
   the old assumption, after reading it yourself to be sure it is one.
   When code outside your diff still follows the old assumption,
   `arbor todo add` bringing it in line.
4. Add each assumption of yours left unchallenged to the file of every system
   it is about. One about code no system covers goes nowhere.

Commit the files with the task. Name each contradiction in your merge report,
as a `- ` line, since the user decided against something an earlier agent
built on.

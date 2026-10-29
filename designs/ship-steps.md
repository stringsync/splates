# Ship steps

## Settled (2026-10-29)

This supersedes `ship-conversation.md` entirely and the plan dialog, review
agents, bump tasks and recovery paragraphs of `ship-cascade.md`. The cascade
design's npm sign-in, push checks, ship command, `SPLATES_SHIP_BUMP` and history
still stand.

- **A ship is a list of steps, one per project in release order.** Each step: wait until every upstream version it takes is live → adopt → publish (the existing runner) → wait until its own version is live. Only then do its dependents start.
- **Adopt is mechanical unless the person ticks Agent task.** Mechanical: move pins, `bun install`, `afterBump`, the project's own merge gate, land. A root project (nothing upstream in the ship) can hold an agent task too, to check things before it publishes.
- **A step holds its task.** The task is added only when the step reaches it, starts from a branch with pins already moved and `afterBump` run, and is run by the ship alone: the step starts its agent, the queue never starts it, and a paused queue does not hold it (the person started the ship). What it waits on, versions and the person's instructions stay in the step. The task's detail is mechanical: what moved, the upstream commit range, the person's instructions, "fix what breaks and merge; never bump further".
- **Any failure stops the whole ship.** The stopped step offers Retry (rerun from the stage that failed), Hand to an agent (on a failed mechanical adopt only: adds its task with the gate failure; the ship carries on once it merges), and Abandon (ends it; what published stays).
- **Recovery is just Retry.** Every stage first checks whether its work is done and skips it: adopt when the base already pins the targets, publish when npm already has the planned version; the live waits only check. A server restart resumes the same way. No Recover plans: after Abandon the plan page reads current pins, tags and commits.
- **Live versions** come from a project's `shipStatus` command (webappwiz's `wiz dev ship status --json`), else npm's `latest` for the public packages splates knows.
- **A plan page at `#ships/plan`**: projects in release order with unshipped commit counts; per project Ship/Leave out, patch/minor/major, an Agent task toggle and instructions appended to its task. Start creates the ship; the Ships page shows step progress with task links.


---
description: Why only the person queues work and agents never start agents, and what an agent does instead (task add, defer, the queue card, the lane's approval budget)
---

Queueing spends the person's tokens, so starting work is
their call: every agent is refused `queue add`, `queue remove`, `queue move`,
`lane queue`, `lane unqueue` and `lane approve`. An auto-run setting that
queued ready tasks by itself, and a `[SPLATES QUEUE]` directive, were both
removed. An agent that wants work queued adds it (`splates task add` or
`defer`) and ends its reply with a permission card (`## 🔐 Permission: queue
lane <n>` or `queue #<n>`), which the page turns into a button. A lane queued
whole gets a budget of the tasks it holds plus twenty it may add; at zero it
stops until the person approves twenty more.

Agents start no agents either. `splates handoff`, `splates tell`, `add
--agent` from an agent, lane orchestrators and parts (a task based on another
task's branch) all went in October 2026 (`designs/simplify.md`); only the
server's queue starts a task on an agent. A harness's own subagents are
outside splates: they work and commit in the parent's worktree, and anything
that should land separately is queued as its own task.

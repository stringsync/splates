---
description: Ready means groomed, not assigned; who grooms a task (the built-in groomer automation, or the agent that takes it) and what grooming does
---

`splates task add` writes a groomed task straight into `ready`; `task defer`
puts a rough one in the backlog. Grooming looks for a task that already asks
the same thing, links what blocks it, puts it in a lane, picks the cheapest
agent, model and effort that cover it, and asks under `## Blocked` any
question that is hard to reverse; a question leaves the task needing the
person but still queueable, and its agent will not merge until it is
answered. Naming an assignee does not make a task ready.

The groomer went back and forth: one agent per project (2026-10-18), then
off in favour of the agent that takes a task grooming it first, then back the
same day as a built-in automation that a backlog deferral or a server start
wakes, each run a fresh conversation archived as resting when it ends. It is
refused `add`, `merge`, `queue add` and `lane queue`, and writes its
questions into the task so they outlive its conversation. With no groomer
on, a task can be queued from `backlog` and the agent that takes it grooms
it as its first step.

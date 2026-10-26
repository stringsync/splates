---
description: How the queue starts tasks: every unblocked queued task starts at once, uncapped, and one whose blocker left the queue goes back to ready
---

`QueueRunner` works the queue down: every queued task in `queueOrder` that
no open task blocks starts as a task of its own at once. Queue starts are
never capped (since 2026-10-23; nothing caps any agent since 2026-10-26);
like the person's agents, they and their held conversations are not
`capped`.

## Starting

- A task starts on the agent and model it names, else on what Auto pick
  decides at start.
- The runner looks again when tasks change, and every minute.
- While the person pauses the queue from the Queue page it starts nothing,
  and a held conversation that would be starting says `paused`. Resuming
  fires the scheduler's `changed`, which sweeps.
- A refused start is retried at once when the task changes or the person
  retries it. Otherwise it waits a number of sweeps that doubles per
  refusal, up to 30.
- A queued task gets a held conversation, which the page shows as its place
  in line, only once it can start. One waiting on a blocker has none, so it
  never sits at an agent.

## Blockers that leave the queue

A queued task waits on blockers only while each is queued or running (since
2026-10-23). One blocked by a task that is neither, or by one removed
without merging, would wait for good. So each check lets it go back to
ready (or backlog), with `unqueuedFor` naming those blockers for the card's
"left the queue: queue #N first" line, and a `queue remove` journal entry.
A chain goes whole in one check (`stalled`). Queueing it again, by hand or
by a lane, clears `unqueuedFor` (`enqueued`).

## Order and lanes

The queue is worked out on every read, never stored: a task comes after
every task it depends on, otherwise in the position the person set. A lane
queued whole queues each waiting task as soon as nothing blocks it.

A failed checkout keeps its worktree and running record even after
releasing its board owner. A lane leaves that record alone, so repeated
checks spend no more of its budget.

A task a queued lane started is told `queuePrompt` with "from the queue,
which lane N queued". The page draws that message as an event line,
`Started <task> from lane <name>`, as it does an early warning; a task the
person queued stays a regular message.

## Worktree names

The worktree name is the task's `slug`, else its subject lowercased, dashed
and cut at a word to 40 characters, with `-2`, `-3` for clashes.

## Where

- `packages/server/queue/runner.ts`: `QueueRunner`, `queuePrompt`
- `packages/server/queue/order.ts`: `stalled`
- `packages/server/queue/name.ts`: worktree names
- `packages/server/queue/testing.ts`: `FakePicker`, standing in for Auto pick
- `packages/web/queue-start.ts`: the lane-start event line
